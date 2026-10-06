import { describe, expect, it } from 'vitest';

import type { MenuNavigationInput } from './MenuNavigator';
import { MenuNavigator } from './MenuNavigator';

const idle: MenuNavigationInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  confirm: false,
  cancel: false,
};

describe('MenuNavigator', () => {
  it('wraps a list and reports confirm/cancel edges once', () => {
    const menu = new MenuNavigator(3);
    menu.update(0, { ...idle, up: true });
    expect(menu.index).toBe(2);
    expect(menu.update(0, { ...idle, confirm: true }).confirmed).toBe(true);
    expect(menu.update(0, { ...idle, confirm: true }).confirmed).toBe(false);
    expect(menu.update(0, { ...idle, cancel: true }).cancelled).toBe(true);
  });

  it('moves through an incomplete grid without leaving its bounds', () => {
    const menu = new MenuNavigator(7, 3);
    menu.setIndex(2);
    menu.update(0, { ...idle, down: true });
    expect(menu.index).toBe(5);
    menu.update(0, idle);
    menu.update(0, { ...idle, down: true });
    expect(menu.index).toBe(6);
    menu.update(0, idle);
    menu.update(0, { ...idle, right: true });
    expect(menu.index).toBe(6);
  });

  it('repeats held movement after a delay', () => {
    const menu = new MenuNavigator(5);
    menu.update(0, { ...idle, down: true });
    expect(menu.index).toBe(1);
    for (let i = 0; i < 5; i++) menu.update(0.05, { ...idle, down: true });
    expect(menu.index).toBe(1);
    menu.update(0.12, { ...idle, down: true });
    expect(menu.index).toBe(2);
  });
});
