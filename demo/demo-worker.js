console.log('Hello, world!');
if (true) {
  console.log('if branch');
} else {
  console.log('else branch');
}
for (let i = 0; i < 3; i++) {
  console.log(i);
}

dispatchEvent(new CustomEvent('swic-save', { detail: {} }));