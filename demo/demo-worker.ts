import { foo } from "./sample";

console.log(
  'Hello, world!');
if (true) {
  console.log('if branch', (() => 42)());
} else {
  console.log('else branch');
}
for (let i = 0; i < 3; i++) {
  foo();
}

dispatchEvent(new CustomEvent('swic-save', { detail: {} }));