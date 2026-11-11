// SPDX-License-Identifier: MPL-2.0
import type { PlanCircuit, PlanIcon } from '@inkadra/doc-schema';
import { layerOf } from './plan.ts';
import { isLight } from './plan-icons.ts';

/**
 * Power of a set (decision 0104): the watts of each light, summed per circuit and turned into
 * amperes at the plan's voltage. A circuit warns above 80 % of its breaker and is over above
 * 100 %. Computed from the plan every time, never stored.
 */

/** Mains voltage of a plan without one. */
export const DEFAULT_VOLTAGE = 230;
/** Share of a breaker above which a circuit warns. */
export const POWER_WARNING = 0.8;

/**
 * Watts read from the free `power` text of version 15: "1,2K", "2 kW", "300 W", "650". Null when
 * it says no number of watts ("HMI").
 */
export function parseWatts(text: string | undefined): number | null {
  if (!text) return null;
  const m = text
    .trim()
    .replace(',', '.')
    .match(/^(\d+(?:\.\d+)?)\s*(k|kw|w)?\b/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  const watts = unit.startsWith('k') ? value * 1000 : value;
  return Number.isFinite(watts) && watts > 0 ? Math.round(watts) : null;
}

/**
 * The watts a light draws: its `watts`, else what its `power` text says; 0 for a light that says
 * nothing and for icons that are not lights.
 */
export function iconWatts(icon: Pick<PlanIcon, 'kind' | 'watts' | 'power'>): number {
  if (!isLight(icon.kind)) return 0;
  return icon.watts ?? parseWatts(icon.power) ?? 0;
}

export type CircuitStatus = 'ok' | 'warning' | 'over';

export interface CircuitLoad {
  /** The circuit's id; null for the lights plugged into no circuit. */
  id: string | null;
  name: string;
  /** Rating of the breaker; null for the lights on no circuit. */
  breaker: number | null;
  watts: number;
  amps: number;
  /** amps / breaker; 0 without a breaker. */
  load: number;
  status: CircuitStatus;
  /** Ids of the lights on it, in the plan's order. */
  lights: string[];
}

export interface PlanPower {
  voltage: number;
  watts: number;
  amps: number;
  /** The plan's circuits in their order, then, if any light is on none, those lights. */
  circuits: CircuitLoad[];
}

/** Amperes drawn by `watts` at `voltage`, to a tenth. */
export function ampsAt(watts: number, voltage: number): number {
  return Math.round((watts / voltage) * 10) / 10;
}

/** The status of a circuit drawing `amps` on a `breaker`. */
export function circuitStatus(drawn: number, breaker: number | null): CircuitStatus {
  if (!breaker) return 'ok';
  if (drawn > breaker) return 'over';
  return drawn > breaker * POWER_WARNING ? 'warning' : 'ok';
}

/**
 * The power of a plan per circuit. `hiddenLayers` left out, as the kit is. A light whose circuit
 * is gone counts on no circuit.
 */
export function planPower(plan: {
  icons?: readonly PlanIcon[] | undefined;
  circuits?: readonly PlanCircuit[] | undefined;
  voltage?: number | undefined;
  hiddenLayers?: readonly string[] | undefined;
}): PlanPower {
  const voltage = plan.voltage ?? DEFAULT_VOLTAGE;
  const circuits = plan.circuits ?? [];
  const ids = new Set(circuits.map((c) => c.id));
  const lights = (plan.icons ?? []).filter(
    (i) => isLight(i.kind) && !plan.hiddenLayers?.includes(layerOf(i)),
  );
  const load = (
    id: string | null,
    name: string,
    breaker: number | null,
    on: PlanIcon[],
  ): CircuitLoad => {
    const watts = on.reduce((sum, i) => sum + iconWatts(i), 0);
    const drawn = ampsAt(watts, voltage);
    return {
      id,
      name,
      breaker,
      watts,
      amps: drawn,
      load: breaker ? drawn / breaker : 0,
      status: circuitStatus(drawn, breaker),
      lights: on.map((i) => i.id),
    };
  };
  const out = circuits.map((c) =>
    load(
      c.id,
      c.name,
      c.amps,
      lights.filter((i) => i.circuit === c.id),
    ),
  );
  const loose = lights.filter((i) => !i.circuit || !ids.has(i.circuit));
  if (loose.length) out.push(load(null, '', null, loose));
  const watts = lights.reduce((sum, i) => sum + iconWatts(i), 0);
  return { voltage, watts, amps: ampsAt(watts, voltage), circuits: out };
}
