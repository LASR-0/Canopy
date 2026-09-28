/**
 * Vapour pressure deficit — shared because the controller derives and stamps it,
 * and the UI previews it, and the two must agree to the digit.
 */

/**
 * Saturation vapour pressure in kPa at a given air temperature, by the Tetens
 * equation. Valid over the range a tent operates in; it diverges below freezing,
 * which is not a growing condition.
 */
export function saturationVapourPressure(tempC: number): number {
  return 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/**
 * Vapour pressure deficit in kPa from air temperature and relative humidity.
 *
 * This is *air* VPD: it assumes leaf temperature equals air temperature. Leaf
 * VPD, which growers often prefer, subtracts an offset of a degree or two for
 * transpirational cooling — but that offset is a property of the canopy and the
 * airflow, not something derivable from these two numbers. Inventing a constant
 * would produce a figure that looks authoritative and is wrong by an unknown
 * amount, so the honest value is reported and the offset left as a future
 * setting.
 *
 * Returns null rather than a number for humidity outside 0–100 or a temperature
 * the equation cannot serve, so a miscalibrated sensor cannot write nonsense into
 * the history.
 */
export function computeVpd(tempC: number, humidityPct: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) return null;
  if (humidityPct < 0 || humidityPct > 100) return null;
  if (tempC <= -237 || tempC > 100) return null;

  const svp = saturationVapourPressure(tempC);
  const vpd = svp * (1 - humidityPct / 100);
  // Three decimals: the display rounds to two, and the extra digit keeps a
  // rollup average from inheriting the rounding of every sample under it.
  return Math.round(vpd * 1000) / 1000;
}
