/** A form made of Bubbles text inputs: typing, tab, a failed submit and a good one. */
import { expect, test } from 'bun:test';
import { NewTestModel, WaitFor, WithFinalTimeout, WithInitialTermSize, RequireEqualOutput } from '@oakoliver/teatest';
import { KeyPressMsg, KeyCode, KeyMod } from '@oakoliver/bubbletea';
import { LoginForm } from './apps/login-form';

const press = (code: number) => new KeyPressMsg({ code, text: '', mod: KeyMod.None });

test('a short password is refused, then the form submits', async () => {
  const tm = NewTestModel(new LoginForm(), WithInitialTermSize(60, 10));
  await WaitFor(tm.output(), (out) => out.includes('Sign in'));

  tm.type('ada');
  tm.send(press(KeyCode.Enter)); // moves to the password field
  tm.type('abc');
  tm.send(press(KeyCode.Enter));
  await WaitFor(tm.output(), (out) => out.includes('password is too short'));

  tm.type('d');
  tm.send(press(KeyCode.Enter));

  const form = await tm.finalModel<LoginForm>(WithFinalTimeout(2000));
  expect(form.submitted).toEqual({ user: 'ada', password: 'abcd' });
});

test('the final screen of a good sign-in is a golden file', async () => {
  const tm = NewTestModel(new LoginForm(), WithInitialTermSize(60, 10));
  tm.type('grace');
  tm.send(press(KeyCode.Tab));
  tm.type('hopper');
  tm.send(press(KeyCode.Enter));
  RequireEqualOutput((await tm.finalOutput(WithFinalTimeout(2000))).read(), 'login-form-submitted');
});
