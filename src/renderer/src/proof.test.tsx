import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('renderer proof', () => {
  it('renders the App component in jsdom', () => {
    render(<App />);
    expect(screen.getByText('Meeting Recorder')).toBeInTheDocument();
  });
});
