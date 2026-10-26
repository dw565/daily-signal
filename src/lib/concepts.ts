import type { ConceptRef, Domain, Question } from "./schema";

/**
 * Seed knowledge carried over from the legacy ChatGPT tutor.
 *
 * EARNED_SEED: concepts the learner demonstrably answered quizzes on.
 * Seeded as knowledge state only — no invented dates, attempts, XP or streak.
 *
 * PENDING_SEED: concepts that were delivered but never quizzed. They are NOT
 * earned and must never be treated as prior knowledge.
 */

const c = (conceptId: string, name: string, domain: Domain): ConceptRef => ({ conceptId, name, domain });

export const EARNED_SEED: ConceptRef[] = [
  c("bond-price-yield", "Bond prices vs. yields", "finance"),
  c("priced-in", "Expectations & “priced in”", "finance"),
  c("fed-dual-mandate", "The Fed’s dual mandate", "finance"),
  c("operating-leverage", "Operating leverage", "finance"),
  c("elasticity", "Elasticity", "finance"),
  c("total-cost-of-ownership", "Total cost of ownership", "finance"),
  c("discount-rates-pv", "Discount rates & present value", "finance"),
  c("credit-spreads", "Credit spreads", "finance"),
  c("bond-auctions", "Bond auctions & bid-to-cover", "finance"),
  c("take-or-pay", "Take-or-pay & volume risk", "finance"),
  c("capacity-factor", "Capacity factor", "energy"),
  c("generation-vs-transmission", "Generation vs. transmission", "energy"),
  c("ppas", "Power purchase agreements", "energy"),
  c("mw-vs-mwh", "MW vs. MWh", "energy"),
  c("cod-completion-risk", "COD & completion risk", "energy"),
  c("energy-security", "Energy security", "energy"),
  c("interconnection", "Interconnection", "energy"),
  c("n-minus-1", "N-1 reliability", "energy"),
  c("nuclear-uprates", "Nuclear uprates", "energy"),
  c("merit-order", "Marginal pricing & merit order", "energy"),
  c("behind-the-meter", "Behind-the-meter", "energy"),
  c("islanded-operation", "Islanded operation", "energy"),
  c("utility-cost-allocation", "Utility cost allocation", "energy"),
];

export const PENDING_SEED: ConceptRef[] = [
  c("revenue-run-rate", "Revenue run rate", "finance"),
  c("heat-pump-cop", "Heat-pump COP", "energy"),
  c("market-cap-weighting", "Market-cap weighting", "finance"),
  c("dispatchability", "Dispatchability", "energy"),
  c("commodity-hedging", "Commodity hedging", "finance"),
  c("long-lead-procurement", "Long-lead procurement", "energy"),
  c("core-inflation", "Core inflation", "finance"),
  c("lcoe-vs-system-value", "LCOE vs. system value", "energy"),
  c("net-interest-margin", "Net interest margin", "finance"),
  c("capital-recycling", "Capital recycling", "finance"),
  c("gaap-adjusted", "GAAP vs. adjusted metrics", "finance"),
  c("renewable-curtailment", "Renewable curtailment", "energy"),
  c("bookings-backlog", "Bookings & backlog", "finance"),
  c("loi-offtake-fid", "LOI, offtake & FID", "energy"),
  c("contribution-margin", "Contribution margin", "finance"),
  c("carbon-removal-mrv", "Carbon-removal MRV", "energy"),
  c("spin-offs-sotp", "Spin-offs & sum-of-the-parts", "finance"),
  c("producer-rents", "Fossil-supply producer rents", "energy"),
  c("equity-dilution", "Primary/secondary equity & dilution", "finance"),
  c("brownfield-development", "Brownfield development", "energy"),
  c("ma-premiums-synergies", "M&A premiums & synergies", "finance"),
  c("nuclear-repeat-build", "Nuclear repeat-build economics", "energy"),
  c("net-income-vs-fcf", "Net income vs. free cash flow", "finance"),
  c("virtual-power-plants", "Virtual power plants", "energy"),
  c("tariff-epc-risk", "Tariff & EPC risk", "energy"),
  c("ipo-timing", "IPO timing", "finance"),
  c("geological-disposal", "Geological disposal", "energy"),
  c("earnings-normalization", "Earnings normalization", "finance"),
  c("mineral-supply-elasticity", "Mineral-supply elasticity", "energy"),
];

const q = (id: string, prompt: string, choices: string[], answerIndex: number, explanation: string): Question => ({
  id,
  prompt,
  choices,
  answerIndex,
  explanation,
});

/**
 * Evergreen spaced-repetition questions keyed by concept ID. Review may only
 * draw from concepts that are EARNED in the ledger (enforced in ledger.ts).
 */
export const REVIEW_BANK: Record<string, Question[]> = {
  "bond-price-yield": [
    q("rv-bond-price-yield-1", "Market interest rates rise after you buy a 10-year fixed-coupon bond. What happens to its market price?", ["It rises", "It falls", "It stays at par until maturity", "It depends only on the issuer’s credit rating"], 1, "New buyers can get the higher rate elsewhere, so your fixed coupon is worth less — the price drops until its yield matches the market."),
  ],
  "priced-in": [
    q("rv-priced-in-1", "A company reports 20% earnings growth and its stock falls. What’s the most likely explanation?", ["Markets ignore earnings", "Investors expected more than 20%", "Stock prices only follow interest rates", "The report was audited late"], 1, "Prices move on surprises versus expectations. If the market was braced for 25%, 20% is a disappointment."),
  ],
  "fed-dual-mandate": [
    q("rv-fed-dual-mandate-1", "The Fed’s dual mandate from Congress targets which two goals?", ["Low unemployment and a strong dollar", "Maximum employment and stable prices", "Balanced budgets and low inflation", "Bank profitability and GDP growth"], 1, "Maximum employment and stable prices — which is why both jobs data and inflation data move rate expectations."),
  ],
  "operating-leverage": [
    q("rv-operating-leverage-1", "Two firms both grow revenue 10%. Which sees the bigger jump in operating profit?", ["The one with mostly variable costs", "The one with mostly fixed costs", "Both grow profit exactly 10%", "Whichever has more debt"], 1, "When most costs are fixed, extra revenue falls largely to profit — that’s operating leverage. It cuts both ways in a downturn."),
  ],
  elasticity: [
    q("rv-elasticity-1", "A gasoline price spike barely changes how much people drive next week. Short-run demand is…", ["Highly elastic", "Inelastic", "Perfectly elastic", "Unit elastic by definition"], 1, "Quantity barely responds to price: inelastic. Over years, people switch cars and commutes, so long-run demand is more elastic."),
  ],
  "total-cost-of-ownership": [
    q("rv-tco-1", "An EV costs more upfront than a gas car. Why might its total cost of ownership still be lower?", ["TCO ignores purchase price", "Lower fuel and maintenance costs over its life can outweigh the premium", "EVs never depreciate", "TCO only counts financing costs"], 1, "TCO adds purchase, energy, maintenance, financing and resale over the asset’s life — upfront price is just one line."),
  ],
  "discount-rates-pv": [
    q("rv-discount-rates-pv-1", "If the discount rate rises, the present value of a project’s far-future cash flows…", ["Rises", "Falls, especially for distant cash flows", "Is unchanged", "Falls only for near-term cash flows"], 1, "Higher rates shrink every future dollar, and compounding makes the hit biggest for cash flows furthest out — why long-lived infrastructure is rate-sensitive."),
  ],
  "credit-spreads": [
    q("rv-credit-spreads-1", "A widening credit spread on a company’s bonds usually signals…", ["Investors see more default risk or demand more compensation", "Treasury yields are falling", "The company issued equity", "Lower borrowing costs ahead"], 0, "The spread is the extra yield over Treasuries for bearing credit risk. Wider spread = lenders want more pay for the risk."),
  ],
  "bond-auctions": [
    q("rv-bond-auctions-1", "A Treasury auction’s bid-to-cover ratio drops well below its recent average. A reasonable read is:", ["Demand for that debt was weaker than usual", "The Treasury defaulted", "Yields must fall", "More bonds were bought than offered"], 0, "Bid-to-cover = bids received ÷ amount offered. A lower ratio means less demand cushion, which can push yields up."),
  ],
  "take-or-pay": [
    q("rv-take-or-pay-1", "A pipeline signs a take-or-pay contract with a shipper. Who mainly bears volume risk?", ["The pipeline owner", "The shipper/buyer", "The regulator", "Nobody — volumes are guaranteed by physics"], 1, "The buyer pays for contracted capacity whether or not they use it, so the seller’s revenue is protected from volume swings."),
  ],
  "capacity-factor": [
    q("rv-capacity-factor-1", "A 100 MW solar farm produced 219,000 MWh in a year (8,760 hours). Its capacity factor is about…", ["10%", "25%", "50%", "100%"], 1, "219,000 ÷ (100 × 8,760) = 0.25. Capacity factor = actual output ÷ output if it ran at full power all year."),
  ],
  "generation-vs-transmission": [
    q("rv-gen-vs-trans-1", "A region has plenty of cheap wind generation but customers can’t get it. The bottleneck is most likely…", ["Generation", "Transmission", "Retail billing", "Capacity factor"], 1, "Generation makes power; transmission moves it in bulk over long distances. Cheap power stranded far from load is a wires problem."),
  ],
  ppas: [
    q("rv-ppas-1", "Why do lenders like a long-term PPA with a creditworthy buyer?", ["It guarantees the plant never breaks", "It makes project revenue more predictable", "It removes construction risk", "It raises the capacity factor"], 1, "A PPA locks in price (and often volume) with a reliable counterparty, so lenders can underwrite steady cash flows."),
  ],
  "mw-vs-mwh": [
    q("rv-mw-vs-mwh-1", "A battery is rated 50 MW / 200 MWh. How long can it discharge at full power?", ["50 minutes", "2 hours", "4 hours", "200 hours"], 2, "MW is power (rate); MWh is energy (amount). 200 MWh ÷ 50 MW = 4 hours."),
  ],
  "cod-completion-risk": [
    q("rv-cod-1", "A project’s commercial operation date (COD) slips six months. Which risk has materialized?", ["Merchant price risk", "Completion risk", "Curtailment risk", "Currency risk"], 1, "Completion risk is the chance a project finishes late, over budget, or not at all — delaying the revenue lenders were counting on."),
  ],
  "energy-security": [
    q("rv-energy-security-1", "Which move most directly improves a country’s energy security?", ["Relying on one foreign supplier for cheaper gas", "Diversifying fuel sources and supply routes", "Raising retail electricity prices", "Exporting more domestic power"], 1, "Energy security means reliable, affordable supply that’s resilient to disruptions — diversification is the classic lever."),
  ],
  interconnection: [
    q("rv-interconnection-1", "A solar developer has land and financing but is stuck in a multi-year queue. What are they waiting for?", ["A PPA", "Interconnection approval to connect to the grid", "A capacity factor study", "Behind-the-meter permits"], 1, "Interconnection studies determine whether and how a project can connect, and what grid upgrades it must pay for."),
  ],
  "n-minus-1": [
    q("rv-n-minus-1-1", "Planning a grid to the N-1 standard means it can…", ["Run with one fewer customer", "Withstand the loss of any single major element without outages", "Operate one day without fuel", "Cut generation by 1%"], 1, "N-1: the system stays stable if any one key component (a line, transformer or plant) fails unexpectedly."),
  ],
  "nuclear-uprates": [
    q("rv-nuclear-uprates-1", "Why is a nuclear uprate attractive compared with a new reactor?", ["It adds output from an existing site, usually faster and cheaper per MW", "It eliminates spent fuel", "It requires no regulatory approval", "It lowers the capacity factor"], 0, "An uprate boosts the licensed power of an existing plant — reusing the site, grid connection and workforce."),
  ],
  "merit-order": [
    q("rv-merit-order-1", "In a merit-order power market, what usually sets the clearing price for everyone?", ["The cheapest plant running", "The most expensive plant needed to meet demand", "The average of all plants’ costs", "The utility’s regulated rate"], 1, "Plants are dispatched from cheapest to costliest; the marginal unit needed to meet demand sets the price all are paid."),
  ],
  "behind-the-meter": [
    q("rv-btm-1", "A factory installs rooftop solar that powers its own operations before any grid export. That’s…", ["Front-of-meter generation", "Behind-the-meter generation", "Transmission-level generation", "A capacity market bid"], 1, "Behind-the-meter assets sit on the customer’s side of the utility meter and first offset the site’s own usage."),
  ],
  "islanded-operation": [
    q("rv-islanded-1", "During a grid outage, a hospital microgrid keeps running on its own generation and storage. It is operating…", ["In merit order", "Islanded", "Under take-or-pay", "At N-1"], 1, "Islanding means disconnecting from the main grid and serving local load independently."),
  ],
  "utility-cost-allocation": [
    q("rv-cost-allocation-1", "A data center needs a new substation. Regulators’ cost-allocation question is mainly:", ["Whether power is renewable", "Who pays — the data center or all ratepayers", "What the capacity factor is", "Whether bonds are priced in"], 1, "Cost allocation decides which customer classes pay for grid investments — central to protecting existing ratepayers."),
  ],
};
