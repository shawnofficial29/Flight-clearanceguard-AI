import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioExplainer } from './components/ScenarioExplainer';

afterEach(() => {
  cleanup();
});

describe('ScenarioExplainer', () => {
  it('states the misheard altitude in three short beats', () => {
    const { container } = render(<ScenarioExplainer />);
    expect(screen.getByText('The scenario: one misunderstood number')).not.toBeNull();
    expect(container.querySelectorAll('ol > li')).toHaveLength(3);
    const text = container.textContent ?? '';
    expect(text).toContain('maintain 23,000 ft');
    expect(text).toContain('mishears 22,000 ft');
    expect(text).toContain('still level');
    expect(text).toContain('ATC, then the pilot');
  });

  it('uses no collision or crash language', () => {
    const { container } = render(<ScenarioExplainer />);
    expect(container.textContent ?? '').not.toMatch(/collision|crash/i);
  });
});
