export function foo() {
  const randomInt = getRandomInt();
  console.log(`foo: ${randomInt}`);
  if (randomInt % 2 === 0) {
    return 2;
  } else if (randomInt % 3 === 0) {
    return 3;
  } else if (randomInt % 5 === 0) {
    return 5;
  } else if (randomInt % 7 === 0) {
    return 7;
  } else {
    return 1;
  }
}

export function bar() {
  console.log("bar");
}

function getRandomInt() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}