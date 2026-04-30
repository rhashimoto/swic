describe('Dummy Test Suite', () => {
  it('should pass a simple test', () => {
    expect(true).toBe(true);
  });

  it('should demonstrate a failing test', () => {
    expect(true).toBe(false);
  });

  it('should verify basic arithmetic', () => {
    expect(2 + 2).toBe(4);
  });
});
