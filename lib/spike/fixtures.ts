import {CSV_FIELDS} from "./exact";
export async function monthlyFixtures(){
 const files:File[]=[];
 for(let m=1;m<=12;m++){
  const month=String(m).padStart(2,"0");
  const rows=Array.from({length:10},(_,i)=>`${m*100+i},${i+1},${i+1},2025-${month}-01,1,100.00,5.00,2.00,1.00,60.00`).join("\n");
  files.push(new File([CSV_FIELDS.join(",")+"\n"+rows+"\n"],`month-${month}.csv`,{type:"text/csv"}));
 }
 const ExcelJS=(await import("exceljs")).default;
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Invoice data");sheet.addRow([...CSV_FIELDS]);
 for(let i=0;i<10;i++)sheet.addRow([String(9000+i),"1","1","2025-12-15","1","100.00","5.00","2.00","1.00","60.00"]);
 files.push(new File([new Uint8Array(await book.xlsx.writeBuffer())],"extra.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
 return files;
}
export function conversionFixtures(){
 const row=["99100","1","1","2025-01-01","1","12.50","0.50","0.25","0.00","8.00"];
 const tsv=new File([CSV_FIELDS.join("\t")+"\n"+row.join("\t")+"\n"],"example.tsv",{type:"text/tab-separated-values"});
 const messy=new File(["\uFEFF"+CSV_FIELDS.join(";")+"\r\n"+row.map((v,i)=>i>4?v.replace(".",","):v).join(";")+"\r\n"],"comma-decimal.csv",{type:"text/csv"});
 return {tsv,messy};
}
