import { requireAppPageContext } from '@/lib/context';
import { AppFrame } from '@/components/AppFrame';
import { LicencePanel } from '@/components/LicencePanel';
export const dynamic="force-dynamic";
export default async function LicencePage(){const context=await requireAppPageContext();return <AppFrame context={context}><h1>Workspace licence</h1><LicencePanel owner={context.role==='owner'}/></AppFrame>;}
