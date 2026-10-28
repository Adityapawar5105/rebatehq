import { z } from "zod";
export const LoginSchema=z.object({email:z.string().trim().email().max(254),inviteToken:z.string().min(32).max(200).optional()});
export const CreateTenantSchema=z.object({name:z.string().trim().min(1).max(120)});
export const InviteSchema=z.object({email:z.string().trim().email().max(254),role:z.enum(["manager","analyst","rep"])});
export const QuoteRequestSchema=z.object({customerId:z.string().uuid(),lines:z.array(z.object({productId:z.string().uuid(),qty:z.coerce.number().positive().max(100000),uom:z.string().trim().min(1).max(16).optional(),discountPct:z.coerce.number().min(0).max(100),rebatePct:z.coerce.number().min(0).max(100),accessory:z.coerce.number().min(0).max(10000000)})).min(1).max(100)});
export const DecisionSchema=z.object({decision:z.enum(["approved","denied"]),note:z.string().trim().max(2000).optional()});
export const MarginPolicySchema=z.object({scopeType:z.enum(["global","category","customer_tier"]),scopeKey:z.string().trim().max(120),target:z.coerce.number().min(0).max(100),floor:z.coerce.number().min(0).max(100),walkAway:z.coerce.number().min(0).max(100)}).refine(value=>value.walkAway<=value.floor&&value.floor<value.target,{message:"Margin thresholds must satisfy walk-away ≤ floor < target."}).refine(value=>value.scopeType==="global"?value.scopeKey==="":value.scopeKey.length>0,{message:"Choose a category or customer tier for a scoped policy."});
export const PrototypeSchema=z.object({
 company:z.object({id:z.string().max(100).optional(),name:z.string().max(200).optional(),currency:z.string().length(3).optional()}).optional(),
 customers:z.array(z.record(z.string(),z.unknown())).max(5000).default([]),products:z.array(z.record(z.string(),z.unknown())).max(20000).default([]),
 orders:z.array(z.record(z.string(),z.unknown())).max(100000).default([]),quotes:z.array(z.record(z.string(),z.unknown())).max(20000).default([]),
 rebates:z.array(z.record(z.string(),z.unknown())).max(10000).default([]),invoices:z.array(z.record(z.string(),z.unknown())).max(100000).default([]),
 supplierCredits:z.array(z.record(z.string(),z.unknown())).max(50000).default([]),alerts:z.array(z.record(z.string(),z.unknown())).max(20000).default([]),
 marginSnapshots:z.array(z.record(z.string(),z.unknown())).max(50000).default([]),costComponents:z.array(z.record(z.string(),z.unknown())).max(100000).default([]),
 marginPolicy:z.record(z.string(),z.unknown()).optional(),users:z.array(z.record(z.string(),z.unknown())).max(500).optional(),
}).passthrough();
export const AcceptInviteSchema=z.object({token:z.string().min(32).max(200)});
