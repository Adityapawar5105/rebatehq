import JSZip from "jszip";
const text=(v:string)=>v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export const stringCell=(ref:string,value:string)=>`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text(value)}</t></is></c>`;
export const numberCell=(ref:string,value:string)=>`<c r="${ref}"><v>${value}</v></c>`;
export async function workbook(overrides:Record<string,string|Uint8Array>={}){
 const header=["SKU","Description","Unit","Cost","Price","Supplier","Date","Quantity","Notes"].map((h,i)=>stringCell(String.fromCharCode(65+i)+"3",h)).join("");
 const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="6" max="6" hidden="1"/></cols><sheetData>
 <row r="1">${stringCell("A1","Supplier cost file")}</row><row r="3">${header}</row>
 <row r="4">${stringCell("A4","P-1")}${stringCell("B4",'<img src=x onerror="alert(1)">')}${stringCell("C4","EA")}${stringCell("D4","12,50")}${numberCell("E4","20")}${stringCell("F4","\uFEFFAcme")}${stringCell("G4","03/04/26")}${numberCell("H4","2")}${stringCell("I4",'=HYPERLINK("https://invalid.test")')}</row>
 <row r="5">${stringCell("A5","P-1")}${stringCell("B5","Second item")}${stringCell("C5","BOX")}${numberCell("D5","13")}<c r="E5"><f>SUM(D5,7)</f><v>999999</v></c>${stringCell("F5","Acme")}${stringCell("G5","2026-10-29")}${numberCell("H5","1")}${stringCell("I5","")}</row>
 </sheetData><mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells></worksheet>`;
 const parts:Record<string,string|Uint8Array>={
 "[Content_Types].xml":`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
 "_rels/.rels":`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
 "xl/workbook.xml":`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Supplier" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
 "xl/_rels/workbook.xml.rels":`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
 "xl/worksheets/sheet1.xml":sheet,
 "xl/worksheets/sheet2.xml":`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${stringCell("A1","Notes only")}</row></sheetData></worksheet>`,
 ...overrides};
 const zip=new JSZip();for(const [name,value]of Object.entries(parts))zip.file(name,value,{date:new Date('2026-10-29T00:00:00Z')});
 return zip.generateAsync({type:"uint8array",compression:"DEFLATE"});
}
