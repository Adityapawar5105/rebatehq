// Generates adversarial test OOXML, not a customer workbook or executable macro.
import { writeFile } from "node:fs/promises";
import { workbook } from "../tests/helpers/upload-fixture";
async function main(){await writeFile("tests/fixtures/messy-supplier.xlsx",await workbook());}
main().catch(()=>{process.stderr.write("Could not generate upload test fixture.\n");process.exitCode=1;});
