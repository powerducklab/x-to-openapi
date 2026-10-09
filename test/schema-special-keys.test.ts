import {expect,it} from 'vitest';
import {jsonSchema} from '../src/openapi/schema';
it('preserves special JSON property names in inferred schemas',()=>{
 const schema=jsonSchema(JSON.parse('{"__proto__":{"safe":true},"constructor":42,"normal":"text"}'));
 expect(Object.keys(schema.properties!)).toEqual(['__proto__','constructor','normal']);
 expect(schema.properties!.__proto__.type).toBe('object');
 expect(schema.required).toContain('__proto__');
 expect(JSON.parse(JSON.stringify(schema)).properties.__proto__.type).toBe('object');
});

it('merges array item schemas with prototype-named properties',()=>{
 const schema=jsonSchema(JSON.parse('[{"__proto__":1,"constructor":"a"},{"__proto__":2,"constructor":"b"}]'));
 expect(Object.keys(schema.items!.properties!)).toEqual(['__proto__','constructor']);
 expect(schema.items!.required).toEqual(['__proto__','constructor']);
});
