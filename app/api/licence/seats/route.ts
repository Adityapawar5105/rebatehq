import { licenceAdmin } from '@/lib/licence-admin-api';
export const runtime='nodejs';
export const GET=(request:Request)=>licenceAdmin(request,'seats');
export const POST=(request:Request)=>licenceAdmin(request,'seats');
