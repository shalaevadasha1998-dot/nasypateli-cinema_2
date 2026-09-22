export function secureIndex(max:number){
  if(max<=0) throw new Error('max must be positive')
  const maxUint=0x100000000
  const limit=Math.floor(maxUint/max)*max
  const buf=new Uint32Array(1)
  do{crypto.getRandomValues(buf)}while(buf[0]>=limit)
  return {index:buf[0]%max,randomBytesHex:buf[0].toString(16).padStart(8,'0')}
}
