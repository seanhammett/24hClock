/*
 * moonphase.js — shapes the moon icon's lit face to the moon's actual phase.
 *
 * The icon is three stacked discs (dark side, lit side, outline); only the lit
 * one is masked, and this file is what draws that mask. Phase depends on the
 * date alone, not on where you are, so this runs off the clock's date rollover
 * rather than the location the day/night slices use.
 */
(function () {
  'use strict';

  var R = 15; // must match the moon icon's discs in newtab.html

  // A moon within a couple of days of new is almost entirely dark, which reads
  // as a plain circle rather than a moon. Hold the lit face at a thin sliver
  // instead. Full moon needs no such floor — a full white disc still reads.
  var MIN_FRACTION = 0.05;

  var litHalf = document.getElementById('moon-lit-half');
  var terminator = document.getElementById('moon-terminator');

  /**
   * Half disc from the top of the circle to the bottom, bulging right or left.
   * Sweep 1 goes clockwise (through the right limb), sweep 0 anticlockwise.
   */
  function halfDisc(onRight) {
    return 'M 0 ' + -R +
      ' A ' + R + ' ' + R + ' 0 0 ' + (onRight ? 1 : 0) + ' 0 ' + R + ' Z';
  }

  /**
   * The terminator — the day/night line on the moon — is a circle seen at an
   * angle, so on the disc it projects to an ellipse sharing the disc's height.
   * Its half-width runs from a full R at new and full moon down to zero at the
   * quarters, where the line is dead straight.
   *
   * Below half-lit the ellipse is subtracted from the lit limb's half disc,
   * leaving a crescent; above half-lit it is added, giving a gibbous face. At
   * exactly half the ellipse is a zero-width no-op either way, so the two cases
   * meet cleanly and the shape sweeps the month without a jump.
   */
  function render(date) {
    if (typeof SunCalc === 'undefined') return;

    var illum = SunCalc.getMoonIllumination(date || new Date());
    var fraction = Math.max(illum.fraction, MIN_FRACTION);
    // phase runs 0 at new through 0.5 at full back to 1 at new; the first half
    // is waxing, which in the northern hemisphere is lit on the right.
    var litOnRight = illum.phase < 0.5;
    var gibbous = fraction > 0.5;

    litHalf.setAttribute('d', halfDisc(litOnRight));
    terminator.setAttribute('rx', (R * Math.abs(1 - 2 * fraction)).toFixed(3));
    terminator.setAttribute('fill', gibbous ? '#fff' : '#000');
  }

  window.MoonPhase = { refresh: render };

  render();
})();
