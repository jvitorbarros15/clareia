\pset format unaligned
\t on
\o /tmp/fixture.json
select json_build_object(
  'pub', (select folder_id from api.publication),
  'deputies', (select json_agg(json_build_object('id', id, 'n', records) order by md5(id::text)) from api.deputies),
  'worst', (select json_build_object('id', deputy_id, 'n', n) from (select deputy_id, count(*) n from api.expenses group by 1 order by 2 desc, 1 limit 1) w),
  'keys', (select json_agg(k order by r desc, k) from (select supplier_key k, sum(records) r from api.supplier_cells where supplier_key is not null group by 1 order by r desc, 1 limit 3000) t),
  'labels', (select json_agg(label order by md5(label)) from (select label from (select distinct label from api.supplier_cells) d order by md5(label) limit 300) t),
  'terms', (select json_agg(w) from (select w from (select distinct (regexp_match(label, '[A-Za-z]{4,}'))[1] w from api.supplier_cells) t where w is not null order by md5(w) limit 200) t2)
);
\o
