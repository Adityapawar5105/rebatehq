import SpikeClient from "./SpikeClient";
// Render configuration for the existing per-request CSP nonce only. No data
// is read here or passed as props. All spike operations run in the Web Worker.
export const dynamic="force-dynamic";
export default function SpikePage(){return <SpikeClient/>;}
