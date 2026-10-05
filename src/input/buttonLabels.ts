import type { ButtonAction, ControllerKind } from './types';

type LabelTable = Readonly<Partial<Record<ButtonAction, string>>>;

const SWITCH_LABELS: LabelTable = {
  jump: 'X',
  sprint: 'B',
  attack: 'Y',
  interact: 'A',
  lockOn: 'ZL',
  dodge: 'B',
  inventory: '−',
  pause: '+',
  cameraReset: 'L',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
  menuConfirm: 'A',
  menuCancel: 'B',
};

const XBOX_LABELS: LabelTable = {
  jump: 'Y',
  sprint: 'A',
  attack: 'X',
  interact: 'B',
  lockOn: 'LT',
  dodge: 'A',
  inventory: 'View',
  pause: 'Menu',
  cameraReset: 'LB',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
  menuConfirm: 'B',
  menuCancel: 'A',
};

const PLAYSTATION_LABELS: LabelTable = {
  jump: '△',
  sprint: '✕',
  attack: '□',
  interact: '○',
  lockOn: 'L2',
  dodge: '✕',
  inventory: 'Create',
  pause: 'Options',
  cameraReset: 'L1',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
  menuConfirm: '○',
  menuCancel: '✕',
};

const KEYBOARD_LABELS: LabelTable = {
  jump: 'Space',
  sprint: 'Shift',
  attack: '左クリック',
  interact: 'E',
  lockOn: '右クリック',
  dodge: 'Ctrl',
  inventory: 'Tab',
  pause: 'Esc',
  cameraReset: 'Q',
  menuUp: '↑',
  menuDown: '↓',
  menuLeft: '←',
  menuRight: '→',
  menuConfirm: 'Enter',
  menuCancel: 'Backspace',
};

const TABLES: Readonly<Record<ControllerKind, LabelTable>> = {
  switch: SWITCH_LABELS,
  xbox: XBOX_LABELS,
  playstation: PLAYSTATION_LABELS,
  generic: XBOX_LABELS,
  keyboard: KEYBOARD_LABELS,
};

/** Display label of the button bound to `action` on a `kind` device. */
export function getButtonLabel(action: ButtonAction, kind: ControllerKind): string {
  return TABLES[kind][action] ?? action;
}

/**
 * Label for the sprint control: gamepads sprint by holding the dodge button,
 * keyboards have a dedicated key.
 */
export function getSprintLabel(kind: ControllerKind): string {
  return kind === 'keyboard'
    ? getButtonLabel('sprint', kind)
    : `${getButtonLabel('dodge', kind)}長押し`;
}
