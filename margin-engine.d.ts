declare const engine: {
  priceFor(product: any, customer: any): number;
  calculateLine(input: any): any;
  calculateOrder(order: any, customer: any, product: any): any;
  calculateQuote(lines: any[], customer: any, products: any): any;
  aggregate(results: any[]): any;
  calculateProductMargin(product: any): any;
  classify(rate: number, policy: any): "green" | "yellow" | "red";
  calculatePassThrough(product: any, oldPrice: number, costChangePct: number, oldCost?: number): any;
  buildMonthlySnapshots(orders: any[], customers: any[], products: any[], companyId?: string): any[];
  trendFor(snapshots: any[], entityType: string, entityId: string): any;
};
export = engine;
