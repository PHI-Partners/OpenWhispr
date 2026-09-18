import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../../../tests/helpers/renderWithApp';
import App from './App';

describe('renderer proof', () => {
  it('renders the App component in jsdom', () => {
    renderWithApp(<App />);
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });
});
