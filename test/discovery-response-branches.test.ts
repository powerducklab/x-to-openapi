import {it,expect} from 'vitest';
import {discoveryToOpenApi} from '../src/discovery.js';
it('preserves every media type and alternative for a shared response status',async()=>{
 const result=await discoveryToOpenApi({title:'branches',operations:[{method:'get',path:'/value',origin:{file:'app.ts'},confidence:'high',responses:[
  {statusCode:'200',description:'JSON',confidence:'high',content:[{mediaType:'application/json',schema:{type:'object',properties:{id:{type:'string'}}}}]},
  {statusCode:'200',description:'text',confidence:'high',content:[{mediaType:'text/plain',schema:{type:'string'}}]},
  {statusCode:'200',description:'alternative',confidence:'high',content:[{mediaType:'application/json',schema:{type:'array',items:{type:'string'}}}]},
 ]}]});
 const response=(result.document as any).paths['/value'].get.responses['200'];
 expect(Object.keys(response.content).sort()).toEqual(['application/json','text/plain']);
 expect(response.content['application/json'].schema.anyOf).toHaveLength(2);
 expect(result.documentValid).toBe(true);
});
