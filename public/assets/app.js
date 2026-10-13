import {types,sectorParam,sectorOf,inSector,filterVenues,capacityRows,mapPoints,validPosition,safeURL,postcodeArea,providerPostcodes,capacityBands,matchingCapacities,clusterOverlappingPoints,clusterSpacingForZoom,studioFilter,latestEdition} from './model.js';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const params=new URLSearchParams(location.search);
const state={query:params.get('q')||'',type:sectorParam(params.get('type')),
  activity:['Live music','Recording','Rehearsal'].includes(params.get('activity'))?params.get('activity'):'',
  area:params.get('area')||'',capacity:[...Object.keys(capacityBands),'unknown'].includes(params.get('capacity'))?params.get('capacity'):'',
  festivalFormat:params.get('festivalFormat')||'',festivalStatus:params.get('festivalStatus')||'',promoterVenue:params.get('promoterVenue')||'',
  view:params.get('view')==='directory'||(['Record label','Live music promoter','Music media (PR / press)','Artist managers & support'].includes(params.get('type'))&&params.get('view')!=='map')?'directory':'map',selected:params.get('venue')||null};
let data,map,layer,visible=[],markers=new Map(),lastFocus=null;

function saveState(){
  const p=new URLSearchParams();
  if(state.query)p.set('q',state.query);
  if(state.type)p.set('type',state.type);
  if(state.activity)p.set('activity',state.activity);
  if(state.area)p.set('area',state.area);
  if(state.capacity)p.set('capacity',state.capacity);
  if(state.festivalFormat)p.set('festivalFormat',state.festivalFormat);
  if(state.festivalStatus)p.set('festivalStatus',state.festivalStatus);
  if(state.promoterVenue)p.set('promoterVenue',state.promoterVenue);
  if(state.view==='directory'||['Record label','Live music promoter','Music festival','Music media (PR / press)','Artist managers & support'].includes(state.type))p.set('view',state.view);
  if(state.selected)p.set('venue',state.selected);
  history.replaceState(null,'',location.pathname+(p.size?'?'+p.toString():''));
}
function editionSummary(e){
  if(!e)return 'Edition not recorded';
  if(!e.start_date)return `${e.year} return announced · Dates to follow`;
  const dates=formatDate(e.start_date)+(e.end_date!==e.start_date?' to '+formatDate(e.end_date):'');
  return (e.first_show_only?'First show: ':'')+dates+(e.status==='Past edition'?' · Past edition':' · Announced');
}
function card(v){
  const type=types[state.type&&inSector(v,state.type)?state.type:sectorOf(v)];
  const matches=state.capacity&&state.capacity!=='unknown'?matchingCapacities(data,v.venue_id,state.capacity):[];
  return `<button class="venue-card${state.selected===v.venue_id?' is-selected':''}" data-venue="${esc(v.venue_id)}" aria-label="View ${esc(v.name)}" style="--venue-colour:${type.colour}">
    <div class="venue-card-top"><span class="type-dot"></span><span class="type-name">${esc(type.short)}</span></div>
    <h3>${esc(v.name)}</h3><p>${v.planned_details?`Under construction · Expected late ${v.planned_details.opening_year}<br>${esc(v.address)}`:v.address?`${esc(v.address)}<br>${esc(v.postcode)}${v.promoter_details?.base_venue_name?`<br>Bristol base at ${esc(v.promoter_details.base_venue_name)}`:''}`:v.festival_details?`${esc(v.festival_details.format)}<br>${esc(v.festival_details.return_status==='Return expected'?'Return expected · Dates unconfirmed':editionSummary(latestEdition(v.festival_details)))}`:v.promoter_details?"Bristol live shows<br>Explore linked venues":v.education_details?`${esc(v.city)}<br>Delivery varies by course`:`${esc(v.city)}<br>No public address recorded`}${v.label_details&&v.address?`<br><span class="card-location-kind">${esc(v.label_details.location_kind)}</span>`:""}</p><span class="card-arrow" aria-hidden="true">↗</span>
    <div class="card-activity">${v.education_details?v.education_details.levels.map(a=>`<span>${esc(a)}</span>`).join(''):v.industry_details?`<span>${esc(v.industry_details.role)}</span>`:(v.label_details||v.promoter_details||v.festival_details?[]:v.activities.filter(a=>a!=='Club nights')).map(a=>`<span>${esc(a)}</span>`).join('')}</div>${matches.length?`<p class="matching-capacity">${matches.map(c=>`${esc(c.space_name)} · ${c.capacity.toLocaleString('en-GB')} · ${esc(c.configuration)}${v.planned_details?' (planned)':''}`).join('<br>')}</p>`:''}</button>`;
}
function empty(){return '<div class="empty-state"><h3>No listings found</h3><p>Try another name or postcode, or clear the filters to explore every listing.</p><button data-reset>Clear all filters</button></div>';}
function fitMap(){
  if(!map||state.view!=='map')return;
  const points=visible.flatMap(v=>mapPoints(v,state.area).map(p=>[p.latitude,p.longitude]));
  if(points.length)map.fitBounds(points,{padding:[48,55],maxZoom:15,animate:false});
}
function updateMarkers(){
  if(!map)return;
  markers.forEach(marker=>marker.closeTooltip());
  layer.clearLayers();markers.clear();
  const items=visible.flatMap(v=>mapPoints(v,state.area).map(site=>{const p=map.latLngToLayerPoint([site.latitude,site.longitude]);return {id:site.point_id||v.venue_id,x:p.x,y:p.y,latitude:site.latitude,longitude:site.longitude,venue:v,site};}));
  for(const item of clusterOverlappingPoints(items,clusterSpacingForZoom(map.getZoom()))){
    const {venue:v,site}=item;
    const colour=types[state.type&&inSector(v,state.type)?state.type:sectorOf(v)].colour;
    const label=v.festival_details?`${v.name} · ${site.venue_name} · ${site.edition_year} site`:v.education_details?`${v.name} · ${site.venue_name}`:v.name;
    const sourcePosition=[site.latitude,site.longitude];
    const displayPosition=item.clustered?map.layerPointToLatLng([item.displayX,item.displayY]):sourcePosition;
    const marker=L.marker(displayPosition,{musicEntityId:v.venue_id,
      icon:L.divIcon({className:'venue-marker',html:`<span class="venue-pin" style="--venue-colour:${colour}"></span>`,iconSize:[18,18],iconAnchor:[9,9]}),
      title:`${label}. ${site.precision}.`,keyboard:true,riseOnHover:true
    }).addTo(layer);
    marker.bindTooltip(esc(label),{direction:'top',offset:[0,-16],className:'venue-tooltip'});
    marker.on('click',()=>{
      openVenue(v.venue_id,false);
    });
    marker.getElement().setAttribute('aria-label',`${label}. ${site.precision}. Open details.`);
    markers.set(site.point_id||v.venue_id,marker);
  }
  markSelected();
}
function scrollSelectedCard(){
  const id=state.view==='directory'?'directory':'venue-list';
  const container=$(id),card=[...container.querySelectorAll('[data-venue]')].find(el=>el.dataset.venue===state.selected);
  if(card&&container.clientHeight&&container.scrollHeight>container.clientHeight){
    const a=card.getBoundingClientRect(),b=container.getBoundingClientRect();
    if(a.top<b.top||a.bottom>b.bottom)container.scrollTop+=a.top-b.top-8;
  }
}
function markSelected(){
  document.querySelectorAll('[data-venue]').forEach(el=>{
    const selected=el.dataset.venue===state.selected;
    el.classList.toggle('is-selected',selected);el.setAttribute('aria-pressed',String(selected));
  });
  markers.forEach((m,id)=>{
    m.getElement()?.classList.toggle('selected',m.options.musicEntityId===state.selected);
    m.setZIndexOffset(m.options.musicEntityId===state.selected?1000:0);
  });
}
function render(){
  const liveVenueMode=state.type==='Live venue';
  const studioMode=studioFilter(state);
  const labelMode=state.type==='Record label';
  const promoterMode=state.type==='Live music promoter';
  const festivalMode=state.type==='Music festival';
  const mediaMode=state.type==='Music media (PR / press)';
  const supportMode=state.type==='Artist managers & support';
  const directoryOnly=promoterMode;
  const entityMode=labelMode||promoterMode||festivalMode||mediaMode||supportMode;
  $('festival-filters').hidden=!festivalMode;
  if(!festivalMode){state.festivalFormat='';state.festivalStatus='';}
  $('festival-format').value=state.festivalFormat;
  $('festival-status').value=state.festivalStatus;
  if(directoryOnly)state.view='directory';
  $('map-view-button').disabled=directoryOnly;
  $('promoter-filters').hidden=!promoterMode;
  $('more-filters').hidden=!liveVenueMode;
  $('extra-filters').hidden=!liveVenueMode;
  $('postcode-filter').hidden=directoryOnly;
  if(directoryOnly){state.area='';$('postcode-area').value='';}
  if(!promoterMode)state.promoterVenue='';
  $('promoter-venue').value=state.promoterVenue;
  if(!liveVenueMode){state.capacity='';$('extra-filters').classList.remove('is-open');$('more-filters').setAttribute('aria-expanded','false');}
  document.querySelector('.activity-filter').hidden=!studioMode;
  if(!studioMode)state.activity='';
  $('capacity-filter').hidden=!liveVenueMode;
  $('capacity-band').value=state.capacity;
  $('capacity-band').disabled=!liveVenueMode;
  $('capacity-help').textContent=promoterMode?'Promoters and agents appear in the directory with their published roles and Bristol links.':labelMode?'Audience capacity applies to live venues. Labels and distributors show their published services and Bristol connections.':mediaMode?'Audience capacity applies to live venues. Media listings include music publications, PR and broadcasters.':supportMode?'Audience capacity applies to live venues. Profiles cover artist management and specialist professional support.':studioMode?'Audience capacity applies to live venues. Studio facilities are listed in each space’s details.':'Matches a published audience layout, including hire layouts. Capacities are not added together.';
  visible=filterVenues(data.venues,state,data);
  if(state.selected&&!visible.some(v=>v.venue_id===state.selected))closeVenue(false);
  const text=visible.length===data.venues.length?`${visible.length} listings to explore`:`${visible.length} of ${data.venues.length} listings`;
  $('result-summary').textContent=text;
  $('filter-count').textContent=`${visible.length} ${visible.length===1?'listing':'listings'} to explore`;
  const pointCount=visible.reduce((n,v)=>n+mapPoints(v,state.area).length,0);
  $('map-count').textContent=`${pointCount} map ${pointCount===1?'dot':'dots'}`;
  $('clear-search').hidden=!state.query;
  $('reset-filters').hidden=!(state.query||state.type||state.activity||state.area||state.capacity||state.promoterVenue||state.festivalFormat||state.festivalStatus);
  $('extra-filter-count').textContent=state.capacity?'(1)':'';
  $('venue-list').innerHTML=visible.length?visible.map(card).join(''):empty();
  $('directory').innerHTML=visible.length?visible.map(card).join(''):empty();
  document.querySelectorAll('[data-activity]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.activity===state.activity)));
  const directory=state.view==='directory';
  $('explorer-body').classList.toggle('directory-mode',directory);
  $('directory').hidden=!directory;$('map-pane').hidden=directory;
  $('map-view-button').setAttribute('aria-pressed',String(!directory));
  $('directory-view-button').setAttribute('aria-pressed',String(directory));
  saveState();
  if(!directory&&map)requestAnimationFrame(()=>{map.invalidateSize();fitMap();updateMarkers();scrollSelectedCard();});
  else {updateMarkers();scrollSelectedCard();}
}
function reset(){
  state.query='';state.type='';state.activity='';state.area='';state.capacity='';state.promoterVenue='';state.festivalFormat='';state.festivalStatus='';$('search').value='';$('venue-type').value='';$('postcode-area').value='';$('capacity-band').value='';render();
}
function websiteLink(url,label,klass=''){
  const clean=safeURL(url);return clean?`<a class="${klass}" href="${esc(clean)}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>`:'';
}
function labelSections(l){
  if(!l)return '';
  return `<section class="detail-section"><h3>Catalogue artist examples</h3><p>${esc(l.artist_examples.join(', '))}</p><p class="checked-note">Examples from published catalogues. This is not an exclusive or complete current roster.</p></section>
    <section class="detail-section"><h3>Recent releases</h3>${l.releases.map(r=>`<div class="label-release"><h4>${esc(r.title)}</h4><p>${esc(r.artist)}${r.release_date?' · '+formatDate(r.release_date):''}</p></div>`).join('')}<p class="checked-note">Examples from the label’s catalogue.</p></section>
`;
}
function promoterSections(p){
  if(!p)return '';
  const venues=[...new Map(p.events.filter(e=>e.venue_id).map(e=>[e.venue_id,e.venue_name])).entries()];
  return `${p.base_venue_id?`<section class="detail-section"><h3>Bristol base</h3><p><a href="?view=map&venue=${encodeURIComponent(p.base_venue_id)}">${esc(p.base_venue_name)} · View venue on map ↗</a></p><p class="checked-note">The map point shows the promoter’s Bristol base at this venue.</p></section>`:''}<section class="detail-section"><h3>Linked venues</h3>${venues.map(([id,name])=>`<p><a href="?view=map&venue=${encodeURIComponent(id)}">${esc(name)} · View on map ↗</a></p>`).join('')}<p class="checked-note">Venues featured in the show examples.</p></section>
    <section class="detail-section"><h3>Dated show examples</h3>${p.events.map(e=>`<div class="label-release"><h4>${esc(e.title)}</h4><p>${formatDate(e.event_date)} · ${esc(e.venue_name)}</p><p>${esc(e.status)}</p></div>`).join('')}<p class="checked-note">Check the promoter for programme changes.</p></section>
    <section class="detail-section"><h3>Artist booking</h3><h4>${p.booking_status==='Open'?'Applications welcome':p.booking_status==='Closed'?'Not seeking applications':'Policy not published'}</h4><p>${esc(p.booking_note)}</p>${websiteLink(p.booking_url,'Artist application route')}</section>
`;
}
function festivalSections(f){
  if(!f)return '';
  return `<section class="detail-section"><h3>Festival format</h3><p>${esc(f.format)}</p></section>
    <section class="detail-section"><h3>Editions & dates</h3>${f.return_status==='Return expected'?'<p>Return expected, dates unconfirmed.</p>':''}${[...f.editions].sort((a,b)=>b.year-a.year).map(e=>`<div class="label-release"><h4>${esc(editionSummary(e))}</h4><p>${esc(e.location)}</p></div>`).join('')}<p class="checked-note">Dates and line-ups can change. Check the festival website before making plans.</p></section>
    <section class="detail-section"><h3>Sites on the map</h3>${f.map_sites?.length?`<p>${f.map_edition_year} sites${f.map_edition_year<latestEdition(f).year?' · Next-edition sites unconfirmed':''}</p>${f.map_sites.map(p=>`<div class="label-release"><h4>${esc(p.venue_name)}</h4><p>${esc(p.precision)}</p><p class="checked-note">${['Venue-published point','OpenStreetMap mapped place'].includes(p.precision)?'Mapped place; entrance not verified.':'Approximate location.'} Check the festival’s travel information before visiting.</p><button class="text-button" data-map-site="${esc(p.point_id)}">Show this site on the map ↗</button></div>`).join('')}`:'<p>No specific site has been verified for mapping yet.</p>'}</section>
    <section class="detail-section"><h3>Festival sites & venues</h3>${f.venues.length?f.venues.map(v=>`<div class="label-release"><h4>${esc(v.venue_name)} · ${v.edition_year}</h4>${v.venue_id?`<a href="?view=map&venue=${encodeURIComponent(v.venue_id)}">View venue on map ↗</a>`:''}</div>`).join(''):'<p>Final venue list has not been verified. See the edition location above.</p>'}<p class="checked-note">Each venue is tied to its stated edition. Past venue lists do not confirm next year’s sites.</p></section>
    <section class="detail-section"><h3>Organiser</h3><p>${esc(f.organiser)}</p>${f.promoter_id?`<p><a href="?type=Live+music+promoter&view=directory&venue=${encodeURIComponent(f.promoter_id)}">View organiser profile ↗</a></p>`:''}${websiteLink(f.organiser_url,'Organiser website')}</section>
    <section class="detail-section"><h3>Artist & participation enquiries</h3><p>${esc(f.opportunity_note)}</p>${websiteLink(f.opportunity_url,'Published application / enquiry information')}</section>`;
}
function educationSections(e){
  if(!e)return '';
  const locations=e.locations.filter(l=>l.address||l.map_position);
  const offers=e.offers.map(o=>`<div class="label-release"><h4>${esc(o.title)}</h4><p>${esc(o.level)} · ${esc(o.subject)}</p><p>${esc(o.summary)}</p>${o.site_venue_name?`<p>Delivery site: <a href="?view=map&venue=${encodeURIComponent(o.site_venue_id)}">${esc(o.site_venue_name)} · View listing ↗</a></p>`:''}${websiteLink(o.url,'Course and programme details')}</div>`).join('');
  const places=locations.map(l=>`<div class="label-release"><h4>${esc(l.name)}</h4><p>${l.address?`${esc(l.address)}, ${esc(l.city)}, ${esc(l.postcode)}`:esc(l.city)} · ${esc(l.location_role)}</p>${l.map_position?`<p>Map position: ${esc(l.map_position.precision)}. Entrance not verified.</p>`:''}</div>`).join('');
  return `<section class="detail-section"><h3>Study and training</h3>${offers}</section>${places?`<section class="detail-section"><h3>Locations</h3>${places}</section>`:''}`;
}
function mediaSections(m){
  if(!m)return '';
  return `<section class="detail-section"><h3>${esc(m.media_kind)}</h3><p>${esc(m.services_or_coverage)}</p></section>`;
}
function beaconRooms(v,rows){
  if(v.venue_id!=='brv-beacon')return '';
  return `<section class="detail-section"><h3>Rooms</h3>${['Beacon Hall','Lantern Hall'].map((name,i)=>`<div class="venue-room"><h4>${i+1}. ${name}</h4><p>${i===0?'Main hall. Hire layouts shown below.':'Second performance room. Performance and hire layouts are shown separately.'}</p><table class="capacity-table"><thead><tr><th scope="col">Layout</th><th scope="col">People</th></tr></thead><tbody>${rows.filter(r=>r.space_name===name).sort((a,b)=>Number(b.configuration.includes('performance'))-Number(a.configuration.includes('performance'))||a.configuration.localeCompare(b.configuration)).map(r=>`<tr><td>${esc(r.configuration)}</td><td>${r.capacity===null?'Not stated':r.capacity.toLocaleString('en-GB')}</td></tr>`).join('')}</tbody></table></div>`).join('')}<p class="capacity-note">Confirm the layout and capacity for your event with Bristol Beacon.</p></section>`;
}
function openVenue(id,pan=true){
  const v=data.venues.find(v=>v.venue_id===id);if(!v)return;
  if($('venue-detail').hidden)lastFocus=document.activeElement;
  state.selected=id;saveState();updateMarkers();markSelected();scrollSelectedCard();
  const rows=capacityRows(data,id),type=types[state.type&&inSector(v,state.type)?state.type:sectorOf(v)];
  const directions=v.address&&!v.planned_details?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([v.name,v.address,v.city,v.postcode].join(', ')):'';
  const relatedFestivals=data.venues.filter(f=>f.festival_details?.venues.some(v=>v.venue_id===id));
  const organisedFestivals=data.venues.filter(f=>f.festival_details?.promoter_id===id);
  const relatedPromoters=data.venues.filter(p=>p.promoter_details?.events.some(e=>e.venue_id===id));
  const contacts=[];
  const educationMapped=!!v.education_details?.locations.some(l=>l.map_position);
  if(v.public_email)contacts.push(`<p><a href="mailto:${esc(v.public_email)}">${esc(v.public_email)}</a></p>`);
  if(v.public_phone)contacts.push(`<p><a href="tel:${esc(v.public_phone.replace(/\s/g,''))}">${esc(v.public_phone)}</a></p>`);
  $('venue-detail').innerHTML=`
    <div class="detail-top" style="--venue-colour:${type.colour}"><div class="venue-card-top"><span class="type-dot"></span><span class="type-name">${esc(type.label)}</span></div>
      <button id="close-venue" class="close-button" aria-label="Close listing details">×</button>
      <h2 id="venue-title" tabindex="-1">${esc(v.name)}</h2><p class="detail-address">${v.planned_details?`${esc(v.address)}<br>${esc(v.city)} · Visitor postcode to be confirmed`:v.address?`${esc(v.address)}<br>${esc(v.city)}, ${esc(v.postcode)}`:v.festival_details?`${esc(v.festival_details.format)}<br>${esc(v.festival_details.return_status==='Return expected'?'Return expected · Dates unconfirmed':editionSummary(latestEdition(v.festival_details)))}`:v.promoter_details?"Bristol live shows · Directory listing":`${esc(v.city)} · No public address recorded`}${v.label_details&&v.address?`<br>${esc(v.label_details.location_kind)}`:""}</p>
      <div class="detail-tags">${v.education_details?v.education_details.levels.map(a=>`<span>${esc(a)}</span>`).join(''):v.industry_details?`<span>${esc(v.industry_details.role)}</span>`:(v.label_details||v.promoter_details||v.festival_details?[]:v.activities.filter(a=>a!=='Club nights')).map(a=>`<span>${esc(a)}</span>`).join('')}</div></div>
    <div class="detail-body"><p>${esc(v.description)}</p>
      <div class="detail-actions">${websiteLink(v.website,v.festival_details?'Festival website / listing':v.promoter_details?'Promoter website / profile':'Official website','primary-link')}${websiteLink(directions,'Directions by address','secondary-link')}</div>
      ${v.aliases.length?`<p class="checked-note">Also known as ${v.aliases.map(esc).join(', ')}.</p>`:''}
      <div class="location-note"><strong>${esc(v.planned_details?'Planned venue site':v.education_details?(educationMapped?'Published locations':'Directory listing'):v.map_position?.precision||(v.festival_details?'Edition-specific sites':'Directory listing'))}</strong>${esc(v.planned_details?v.planned_details.visitor_address_note:v.education_details?(educationMapped?'Map dots show published provider bases or teaching sites. Some mark a named place; others mark a postcode centre. Check the programme details before visiting.':'Delivery varies by course. Check the programme details for current teaching locations.'):(v.map_position?(['Venue-published point','OpenStreetMap mapped place'].includes(v.map_position.precision)?'Mapped place, not a verified public entrance. Use the address and official website to plan your visit.':'Approximate postcode location. Use the address and official website to plan your visit.'):v.festival_details?'Festival dots show the sites and edition year listed below. Previous sites do not confirm the next edition’s venues.':v.promoter_details?'Promoters are shown through their live shows. Explore the linked venues below.':v.media_details?'A current public business address has not been verified. This listing remains in the directory.':'A public business address has not been recorded. This listing has no map dot. Use the official contact route.'))}</div>
      ${v.planned_details?`<section class="detail-section"><h3>Planned opening and capacity</h3><p><strong>${esc(v.planned_details.status)} · ${esc(v.planned_details.opening_note)}</strong></p><p><strong>${rows[0]?.capacity.toLocaleString('en-GB')||'Capacity to be confirmed'}</strong> planned maximum audience capacity. Final event layouts and licensed capacities may vary.</p></section>`:''}
      ${beaconRooms(v,rows)}
      ${relatedPromoters.length?`<section class="detail-section"><h3>Promoters in show examples</h3>${relatedPromoters.map(p=>`<p><a href="?type=Live+music+promoter&view=directory&venue=${encodeURIComponent(p.venue_id)}">${esc(p.name)} · View profile ↗</a></p>`).join('')}<p class="checked-note">Other promoters may also use this venue.</p></section>`:''}
      ${relatedFestivals.length?`<section class="detail-section"><h3>Festival venue links</h3>${relatedFestivals.map(f=>`<p><a href="?type=Music+festival&view=directory&venue=${encodeURIComponent(f.venue_id)}">${esc(f.name)} · ${[...new Set(f.festival_details.venues.filter(v=>v.venue_id===id).map(v=>v.edition_year))].join(', ')} ↗</a></p>`).join('')}<p class="checked-note">Links refer to those published editions.</p></section>`:''}
      ${organisedFestivals.length?`<section class="detail-section"><h3>Festivals organised</h3>${organisedFestivals.map(f=>`<p><a href="?type=Music+festival&view=directory&venue=${encodeURIComponent(f.venue_id)}">${esc(f.name)} ↗</a></p>`).join('')}</section>`:''}
      ${labelSections(v.label_details)}${promoterSections(v.promoter_details)}${festivalSections(v.festival_details)}${educationSections(v.education_details)}${mediaSections(v.media_details)}
      ${v.industry_details?`<section class="detail-section"><h3>${esc(v.industry_details.role)}</h3><p>${esc(v.industry_details.services_or_coverage)}</p>${v.industry_details.relationship?`<p>${esc(v.industry_details.relationship)}</p>`:''}${v.industry_details.sectors.length>1?`<p class="checked-note">Also listed under: ${v.industry_details.sectors.filter(s=>s!==state.type).map(s=>esc(types[s].label)).join(', ')}</p>`:''}</section>`:''}
      ${v.studio_details?`<section class="detail-section"><h3>Studio & rehearsal facilities</h3>${v.studio_details.recording_offer?`<h4>Recording</h4><p>${esc(v.studio_details.recording_offer)}</p>`:''}${v.studio_details.rehearsal_offer?`<h4>Rehearsal</h4><p>${esc(v.studio_details.rehearsal_offer)}</p>`:''}${v.studio_details.equipment_summary?`<h4>Equipment</h4><p>${esc(v.studio_details.equipment_summary)}</p>`:''}<h4>Booking</h4><p>${esc(v.studio_details.booking_note)}</p>${websiteLink(v.studio_details.booking_url,'Booking & enquiries','primary-link')}</section>`:''}
      ${v.venue_id==='brv-beacon'||v.planned_details||v.venue_type==='Studios & rehearsal spaces'||v.label_details||v.promoter_details||v.festival_details||v.education_details||v.media_details||v.industry_details?'':`<section class="detail-section"><h3>Audience capacities</h3>${rows.length?`<table class="capacity-table"><thead><tr><th scope="col">Space & layout</th><th scope="col">People</th></tr></thead><tbody>${rows.map(c=>`<tr class="${matchingCapacities(data,id,state.capacity).includes(c)&&state.capacity?'capacity-match':''}"><td>${esc(c.space_name)}<br><span style="color:#77836d">${esc(c.configuration)}</span>${c.capacity_note?`<p class="capacity-note">${esc(c.capacity_note)}</p>`:''}</td><td>${c.capacity===null?'Not stated':c.capacity.toLocaleString('en-GB')}</td></tr>`).join('')}</tbody></table><p class="capacity-note">${state.capacity&&state.capacity!=='unknown'?'Highlighted layouts match your filter. ':''}Published layouts. Confirm the capacity for your event with the venue.</p>`:'<p>Audience capacities have not been recorded yet.</p>'}</section>`}
      ${v.label_details||v.promoter_details||v.education_details||v.media_details||v.industry_details?'':`<section class="detail-section"><h3>Access information</h3>${v.access_url?websiteLink(v.access_url,v.planned_details?'Read the planned access information':v.festival_details?'Read the festival’s access information':'Read the space’s access information'):v.festival_details?'<p>No dedicated access page verified. Contact the organiser about access for your event.</p>':'<p>Detailed access information still needs to be added. Contact the space before your visit.</p>'}</section>`}
      <section class="detail-section"><h3>Get in touch</h3>${contacts.length?contacts.join(''):v.label_details||v.promoter_details||v.festival_details||v.media_details||v.industry_details?'':'<p>Use the official website for enquiries.</p>'}${v.label_details?`<p>${esc(v.label_details.contact_note)}</p>${websiteLink(v.label_details.contact_url,'Official contact route')}`:''}${v.promoter_details?`<p>${esc(v.promoter_details.contact_note)}</p>${websiteLink(v.promoter_details.contact_url,'Published enquiry route')}`:''}${v.festival_details?`<p>${esc(v.festival_details.contact_note)}</p>${websiteLink(v.festival_details.contact_url,'Festival contact route')}`:''}${v.education_details?websiteLink(v.education_details.contact_url,'Contact provider'):''}${v.media_details?`<p>${esc(v.media_details.contact_note)}</p>${websiteLink(v.media_details.contact_url,'Published contact route')}`:''}${v.industry_details?`<p>${esc(v.industry_details.contact_note)}</p>${websiteLink(v.industry_details.contact_url,'Published contact route')}`:''}</section>

    </div>`;
  $('venue-detail').setAttribute('aria-labelledby','venue-title');
  $('venue-detail').setAttribute('aria-modal',String(matchMedia('(max-width:650px)').matches));
  $('venue-detail').hidden=false;$('detail-scrim').hidden=false;
  $('venue-detail').scrollTop=0;$('venue-title').focus({preventScroll:true});
  $('close-venue').addEventListener('click',()=>closeVenue());
  if(pan&&map&&state.view==='map'&&validPosition(v))map.setView([mapPoints(v,state.area)[0].latitude,mapPoints(v,state.area)[0].longitude],Math.max(map.getZoom(),16),{animate:false});
}
function formatDate(d){return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T00:00:00Z'));}
function closeVenue(restore=true){
  $('venue-detail').hidden=true;$('detail-scrim').hidden=true;state.selected=null;updateMarkers();markSelected();saveState();
  if(restore){if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});else $('search').focus({preventScroll:true});}
}
function initMap(){
  if(!window.L){$('map-error').hidden=false;state.view='directory';$('map-view-button').disabled=true;return;}
  map=L.map('map',{zoomControl:false,scrollWheelZoom:false}).setView([51.455,-2.589],13);
  L.control.zoom({position:'topright'}).addTo(map);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    keepBuffer:2});
  let loaded=false,failed=0;
  tiles.on('tileload',()=>{loaded=true;$('map-error').hidden=true;});
  tiles.on('tileerror',()=>{failed++;if(!loaded&&failed>3)$('map-error').hidden=false;});
  tiles.addTo(map);layer=L.layerGroup().addTo(map);
  map.on('zoomend',updateMarkers);
  window.addEventListener('resize',()=>map.invalidateSize());
}
async function init(){
  try{
    const response=await fetch('assets/venues.json');if(!response.ok)throw new Error('Venue data could not be loaded.');
    data=await response.json();
    $('total-venues').textContent=data.venues.length;
    $('total-types').textContent=Object.keys(types).length;
    for(const [name,t]of Object.entries(types)){
      const option=document.createElement('option');option.value=name;option.textContent=t.label;$('venue-type').append(option);
    }
    const areas=[...new Set(data.venues.flatMap(v=>providerPostcodes(v).map(postcodeArea)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(![...areas,'unpublished'].includes(state.area))state.area='';
    for(const area of areas){const option=document.createElement('option');option.value=area;option.textContent=area;$('postcode-area').append(option);}
    const linked=[...new Map(data.venues.flatMap(v=>v.promoter_details?.events||[]).filter(e=>e.venue_id).map(e=>[e.venue_id,e.venue_name])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
    if(!linked.some(([id])=>id===state.promoterVenue))state.promoterVenue='';
    $('promoter-venue').innerHTML='<option value="">All linked venues</option>'+linked.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
    $('postcode-area').value=state.area;$('capacity-band').value=state.capacity;
    if(state.capacity){$('extra-filters').classList.add('is-open');$('more-filters').setAttribute('aria-expanded','true');}
    $('footer-data-note').textContent=`${data.venues.length} music listings`;
    $('legend-types').innerHTML=Object.entries(types).filter(([name])=>data.venues.some(v=>inSector(v,name)&&validPosition(v))).map(([name,t])=>`<div class="legend-item" style="--venue-colour:${t.colour}"><span class="type-dot"></span>${esc(t.label)}</div>`).join('');
    $('search').value=state.query;$('venue-type').value=state.type;
    initMap();const selected=state.selected;render();if(selected&&visible.some(v=>v.venue_id===selected))openVenue(selected,false);
    $('search').addEventListener('input',e=>{state.query=e.target.value;render();});
    $('clear-search').addEventListener('click',()=>{state.query='';$('search').value='';render();$('search').focus();});
    $('venue-type').addEventListener('change',e=>{state.type=e.target.value;if(['Record label','Live music promoter','Music festival','Music media (PR / press)','Artist managers & support'].includes(state.type)){state.activity='';state.area='';state.capacity='';$('postcode-area').value='';state.view=state.type==='Music festival'?'map':'directory';}render();});
    $('festival-format').addEventListener('change',e=>{state.festivalFormat=e.target.value;render();});
    $('festival-status').addEventListener('change',e=>{state.festivalStatus=e.target.value;render();});
    $('promoter-venue').addEventListener('change',e=>{state.promoterVenue=e.target.value;render();});
    $('postcode-area').addEventListener('change',e=>{state.area=e.target.value;render();});
    $('capacity-band').addEventListener('change',e=>{state.capacity=e.target.value;render();});
    $('more-filters').addEventListener('click',()=>{const open=$('extra-filters').classList.toggle('is-open');$('more-filters').setAttribute('aria-expanded',String(open));});
    $('legend-toggle').addEventListener('click',()=>{const open=$('map-legend').classList.toggle('is-open');$('legend-toggle').setAttribute('aria-expanded',String(open));});
    document.querySelectorAll('[data-activity]').forEach(b=>b.addEventListener('click',()=>{state.activity=b.dataset.activity;render();}));
    $('reset-filters').addEventListener('click',reset);
    for(const id of ['venue-list','directory'])$(id).addEventListener('click',e=>{
      const card=e.target.closest('[data-venue]');if(card)openVenue(card.dataset.venue);
      if(e.target.closest('[data-reset]'))reset();
    });
    $('venue-detail').addEventListener('click',e=>{const button=e.target.closest('[data-map-site]');if(!button)return;const v=data.venues.find(v=>v.venue_id===state.selected),p=mapPoints(v,state.area).find(p=>p.point_id===button.dataset.mapSite);if(!p)return;state.view='map';render();map.setView([p.latitude,p.longitude],16,{animate:false});updateMarkers();});
    $('map-view-button').addEventListener('click',()=>{state.view='map';render();});
    $('directory-view-button').addEventListener('click',()=>{state.view='directory';render();});
    $('fit-map').addEventListener('click',fitMap);
    document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.closeDialog).close()));
    $('detail-scrim').addEventListener('click',()=>closeVenue());
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('venue-detail').hidden&&!document.querySelector('dialog[open]'))closeVenue();});
    // The phone panel behaves as a modal. Keep keyboard focus within it.
    $('venue-detail').addEventListener('keydown',e=>{if(e.key!=='Tab'||!matchMedia('(max-width:650px)').matches)return;const nodes=[...$('venue-detail').querySelectorAll('button,a[href],summary')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('venue-title'))){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
  }catch(error){
    console.error(error);$('result-summary').textContent='The music register could not load.';
    $('venue-list').innerHTML='<div class="empty-state"><h3>Unable to load listings</h3><p>Refresh the page to try again.</p><button data-reload>Reload page</button></div>';
    document.querySelector('[data-reload]')?.addEventListener('click',()=>location.reload());
  }
}
init();
