import {it,expect,vi} from 'vitest';
vi.mock('../src/validation/openapi32.js',()=>({validateOpenApi32:vi.fn().mockRejectedValue(new Error('validator unavailable'))}));
import {discoveryToOpenApi} from '../src/discovery.js';
it('does not certify a document when validation could not run',async()=>{
 const r=await discoveryToOpenApi({title:'test',operations:[]});
 expect(r.documentValid).toBe(false);
 expect(r.ok).toBe(false);
 expect(r.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code:'OAS_VALIDATOR_FAILED',severity:'error'})]));
});
