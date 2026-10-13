export const types = {
  'Live venue': {colour:'#345cdb',label:'Live venues',short:'Live venue'},
  'Record label': {colour:'#d16b37',label:'Record labels and distributors',short:'Labels / distributors'},
  'Studios & rehearsal spaces': {colour:'#bb4b80',label:'Studios & rehearsal spaces',short:'Studio / rehearsal'},
  'Live music promoter': {colour:'#287f89',label:'Live music promoters and agents',short:'Promoters / agents'},
  'Music festival': {colour:'#7a59aa',label:'Festivals',short:'Festival'},
  'Music education & skills training': {colour:'#4b7853',label:'Music education & skills training',short:'Education / training'},
  'Music media (PR / press)': {colour:'#b43c49',label:'Music Media',short:'Music Media'},
  'Artist managers & support': {colour:'#6755a2',label:'Artist managers and support',short:'Artist support'}
};
const legacyVenueTypes=['Concert hall','Dedicated music venue','Arts/community venue','Pub/bar with music','Multiuse venue'];
export function sectorParam(value) { return legacyVenueTypes.includes(value)?'Live venue':types[value]?value:''; }
export function sectorOf(v) {
  if(v.label_details)return 'Record label';
  if(v.promoter_details)return 'Live music promoter';
  if(v.festival_details)return 'Music festival';
  if(v.education_details)return 'Music education & skills training';
  if(v.media_details)return 'Music media (PR / press)';
  if(v.industry_details)return v.industry_details.sectors[0];
  return v.venue_type==='Studios & rehearsal spaces'?'Studios & rehearsal spaces':'Live venue';
}
export function inSector(v,type) { return !type||(type==='Studios & rehearsal spaces'?!!v.studio_details:v.industry_details?v.industry_details.sectors.includes(type):sectorOf(v)===type); }
export function normalise(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,'').toLowerCase();
}
export function postcodeArea(postcode) { return String(postcode||'').toUpperCase().replace(/\s/g,'').slice(0,-3); }
export function providerPostcodes(v) { return [...new Set([v.postcode,...(v.education_details?.locations||[]).map(l=>l.postcode),...(v.festival_details?.map_sites||[]).map(s=>s.postcode)].filter(Boolean))]; }
export function studioFilter(state) { return state.type==='Studios & rehearsal spaces'||['Recording','Rehearsal'].includes(state.activity); }
export function filterVenues(venues, {query='',type='',activity='',area='',promoterVenue='',festivalFormat='',festivalStatus=''}={}, data={capacities:[]}) {
  const clean=normalise(query).trim();
  const terms=clean.split(/\s+/).filter(Boolean);
  const compact=clean.replace(/\s/g,'');
  return venues.filter(v=>{
    const educationTerms=v.education_details?[...v.education_details.levels,...v.education_details.offers.flatMap(o=>[o.title,o.level,o.subject,o.site_venue_name]),...v.education_details.locations.flatMap(l=>[l.name,l.address,l.postcode,l.city])]:[];
    const mediaTerms=v.media_details?[v.media_details.media_kind,v.media_details.services_or_coverage]:[];
    const industryTerms=v.industry_details?[v.industry_details.role,v.industry_details.services_or_coverage,v.industry_details.relationship]:[];
    const haystack=normalise([v.name,...v.aliases,v.address,v.city,v.postcode,...capacityRows(data,v.venue_id).map(c=>c.space_name),...(v.promoter_details?.events||[]).map(e=>e.venue_name),v.festival_details?.organiser,...(v.festival_details?.editions||[]).map(e=>e.location),...(v.festival_details?.venues||[]).map(e=>e.venue_name),...educationTerms,...mediaTerms,...industryTerms].join(' '));
    const codes=providerPostcodes(v);
    const search=terms.every(t=>haystack.includes(t))||(compact&&codes.some(code=>normalise(code).replace(/\s/g,'').includes(compact)));
    const areaMatch=!area||(area==='unpublished'?codes.length===0:codes.some(code=>postcodeArea(code)===area));
    const typeMatch=inSector(v,sectorParam(type));
    return (!festivalFormat||v.festival_details?.format===festivalFormat)&&(!festivalStatus||v.festival_details?.return_status===festivalStatus)&&(!promoterVenue||v.promoter_details?.events.some(e=>e.venue_id===promoterVenue)) && typeMatch && (!activity||v.activities.includes(activity)) && areaMatch && search;
  }).sort((a,b)=>{
    if(!clean)return 0;
    const rank=v=>normalise(v.name)===clean?0:normalise(v.name).includes(clean)?1:2;
    return rank(a)-rank(b);
  });
}
export function capacityRows(data,id) { return data.capacities.filter(c=>c.venue_id===id); }
export function mapPoints(v,area='') {
  const points=v.festival_details?.map_sites||v.education_details?.locations?.filter(l=>l.map_position).map(l=>({...l.map_position,point_id:l.location_id,venue_name:l.name,address:l.address,postcode:l.postcode}))|| (v.map_position?[{...v.map_position,point_id:v.venue_id,venue_name:v.name,postcode:v.postcode}]:[]);
  return points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&(!area||area==='unpublished'||postcodeArea(p.postcode)===area));
}
export function validPosition(v) { return mapPoints(v).length>0; }
export function safeURL(value) { try { const u=new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }

// Give coincident map points a small, clickable radial layout without moving
// nearby but distinct locations or drawing lines back to the shared point.
export function clusterSpacingForZoom(zoom) {
  return Math.max(9,Math.min(20,9+(zoom-10)*2.2));
}

export function clusterOverlappingPoints(items, spacing=20) {
  const result=items.map(item=>({...item,displayX:item.x,displayY:item.y,clustered:false}));
  const groups=new Map();
  items.forEach((item,index)=>{
    const key=`${item.latitude},${item.longitude}`;
    groups.set(key,[...(groups.get(key)||[]),index]);
  });
  for(const group of groups.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>String(items[a].id)<String(items[b].id)?-1:String(items[a].id)>String(items[b].id)?1:0);
    const radius=spacing/(2*Math.sin(Math.PI/group.length));
    group.forEach((index,position)=>{
      const angle=-Math.PI/2+position*2*Math.PI/group.length;
      result[index].displayX=items[index].x+Math.cos(angle)*radius;
      result[index].displayY=items[index].y+Math.sin(angle)*radius;
      result[index].clustered=true;
    });
  }
  return result;
}

export function latestEdition(f){return f?.editions?.reduce((latest,e)=>!latest||e.year>latest.year?e:latest,null)||null;}
