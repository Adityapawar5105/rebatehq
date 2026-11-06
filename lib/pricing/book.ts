// One pricing policy, with scalar and bulk execution shapes. SQL expressions are code-owned.
type Inputs={product:string;category:string;customer:string;tier:string;quantity:string;date:string};
const order="(m.customer_id IS NOT NULL) DESC,(coalesce(m.tier,'')<>'') DESC,(m.product_id IS NOT NULL) DESC,m.qty_break DESC,m.valid_from DESC,m.id";
function eligible(x:Inputs,contractOnly:boolean){return `(m.customer_id IS NULL OR m.customer_id=${x.customer}) ${contractOnly?'AND m.customer_id IS NOT NULL':''}
 AND (m.customer_id IS NOT NULL OR m.tier IS NULL OR m.tier='' OR m.tier=${x.tier})
 AND m.valid_from<=${x.date} AND (m.valid_to IS NULL OR m.valid_to>${x.date}) AND m.qty_break<=${x.quantity}`;}
export function matrixLookup(x:Inputs,contractOnly=false){
 return `SELECT m.* FROM (SELECT * FROM price_matrix pm WHERE pm.product_id=${x.product}
 UNION ALL SELECT * FROM price_matrix pm WHERE pm.product_id IS NULL AND pm.category=${x.category}) m WHERE ${eligible(x,contractOnly)} ORDER BY ${order} LIMIT 1`;
}
/** Input has unique lookup_id, product_id, category, customer_id, tier, quantity and as_of.
 * Bulk equality joins avoid a decorrelated LATERAL product/customer Cartesian expansion. */
export function resolvedBook(inputSql:string,contractOnly=false){
 const x={product:'i.product_id',category:'i.category',customer:'i.customer_id',tier:'i.tier',quantity:'i.quantity',date:'i.as_of'};
 return `WITH entries AS(${inputSql}), candidates AS(
 SELECT i.lookup_id,m.* FROM entries i JOIN price_matrix m ON m.product_id=i.product_id WHERE ${eligible(x,contractOnly)}
 UNION ALL SELECT i.lookup_id,m.* FROM entries i JOIN price_matrix m ON m.product_id IS NULL AND m.category=i.category WHERE ${eligible(x,contractOnly)}),
 picked AS(SELECT m.* FROM candidates m QUALIFY row_number() OVER(PARTITION BY lookup_id ORDER BY ${order})=1)
 SELECT i.*,m.id AS matrix_id,m.price AS book_price,m.tier AS book_tier,m.customer_id AS book_customer,m.valid_to AS book_valid_to,coalesce(m.qty_break,0) AS book_break
 FROM entries i LEFT JOIN picked m USING(lookup_id)`;
}
