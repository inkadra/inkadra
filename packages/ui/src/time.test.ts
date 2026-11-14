// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { minuteOptions, parseTime, stepTime, timeParts, timeValue, typeDigit } from './time.ts';

const h24 = { hour12: false, pm: false };

describe('typing a time', () => {
  it('fills the hours with one or two digits in 24 h', () => {
    expect(typeDigit('h', '', 1, h24)).toEqual({ value: 1, buffer: '1', done: false });
    expect(typeDigit('h', '1', 9, h24)).toEqual({ value: 19, buffer: '', done: true });
    // 3-9 cannot start an hour of two digits: they complete it at once.
    expect(typeDigit('h', '', 7, h24)).toEqual({ value: 7, buffer: '', done: true });
    // Over 23 starts again from the new digit.
    expect(typeDigit('h', '2', 5, h24)).toEqual({ value: 5, buffer: '', done: true });
    expect(typeDigit('h', '2', 1, h24)).toEqual({ value: 21, buffer: '', done: true });
  });

  it('keeps the half of the day in 12 h', () => {
    expect(typeDigit('h', '', 7, { hour12: true, pm: true })).toMatchObject({ value: 19, done: true });
    expect(typeDigit('h', '1', 2, { hour12: true, pm: false })).toMatchObject({ value: 0 });
    expect(typeDigit('h', '1', 2, { hour12: true, pm: true })).toMatchObject({ value: 12 });
    expect(typeDigit('h', '', 2, { hour12: true, pm: false })).toMatchObject({ value: 2, done: true });
    expect(typeDigit('h', '1', 5, { hour12: true, pm: false })).toMatchObject({ value: 5, done: true });
  });

  it('fills the minutes and refuses over 59', () => {
    expect(typeDigit('m', '', 4, h24)).toEqual({ value: 4, buffer: '4', done: false });
    expect(typeDigit('m', '4', 2, h24)).toEqual({ value: 42, buffer: '', done: true });
    expect(typeDigit('m', '', 7, h24)).toEqual({ value: 7, buffer: '', done: true });
  });
});

describe('the stored value', () => {
  it('reads and writes HH:MM', () => {
    expect(timeParts('07:30')).toEqual({ h: 7, m: 30 });
    expect(timeParts('24:00')).toEqual({ h: null, m: null });
    expect(timeParts('')).toEqual({ h: null, m: null });
    expect(timeValue({ h: 7, m: 5 })).toBe('07:05');
    // Only an hour given: the minutes become 00.
    expect(timeValue({ h: 7, m: null })).toBe('07:00');
    expect(timeValue({ h: null, m: 30 })).toBe('');
  });
});

describe('the arrow keys', () => {
  const now = { h: 9, m: 41 };
  it('wraps hours and minutes', () => {
    expect(stepTime({ h: 23, m: 10 }, 'h', 1, now)).toEqual({ h: 0, m: 10 });
    expect(stepTime({ h: 0, m: 10 }, 'h', -1, now)).toEqual({ h: 23, m: 10 });
    expect(stepTime({ h: 7, m: 59 }, 'm', 1, now)).toEqual({ h: 7, m: 0 });
    expect(stepTime({ h: 7, m: 5 }, 'm', -15, now)).toEqual({ h: 7, m: 50 });
    expect(stepTime({ h: 7, m: 5 }, 'p', 1, now)).toEqual({ h: 19, m: 5 });
  });
  it('starts an empty field from the given time', () => {
    expect(stepTime({ h: null, m: null }, 'm', 1, now)).toEqual({ h: 9, m: 42 });
  });
});

describe('a pasted time', () => {
  it.each([
    ['1930', { h: 19, m: 30 }],
    ['19:30', { h: 19, m: 30 }],
    ['19.30', { h: 19, m: 30 }],
    ['7:30 pm', { h: 19, m: 30 }],
    ['7:30 AM', { h: 7, m: 30 }],
    ['12:15 am', { h: 0, m: 15 }],
    ['7pm', { h: 19, m: 0 }],
    ['7', { h: 7, m: 0 }],
    ['730', { h: 7, m: 30 }],
  ])('understands %s', (text, parts) => expect(parseTime(text)).toEqual(parts));
  it.each(['25:00', '7:75', '13 pm', 'tomorrow', ''])('refuses %s', (text) =>
    expect(parseTime(text)).toBeNull(),
  );
});

it('lists minutes in steps with an odd typed minute in its place', () => {
  expect(minuteOptions(5, null)).toHaveLength(12);
  expect(minuteOptions(5, 42).slice(8, 11)).toEqual([40, 42, 45]);
  expect(minuteOptions(5, 30)).toHaveLength(12);
});
