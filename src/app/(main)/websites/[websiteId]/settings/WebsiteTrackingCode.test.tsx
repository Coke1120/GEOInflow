import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { WebsiteTrackingCode } from './WebsiteTrackingCode';

const { websiteMock } = vi.hoisted(() => ({ websiteMock: vi.fn() }));

vi.mock('@/components/hooks', () => ({
  useConfig: () => ({ cloudMode: false }),
  useMessages: () => ({
    t: (value: string) => value,
    labels: { trackingCode: 'Tracking code' },
    messages: { trackingCode: 'Paste before the closing head tag' },
  }),
  useWebsite: () => websiteMock(),
}));

// jsdom's localStorage is an empty object in this repo; react-zen's theme init reads it.
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

describe('WebsiteTrackingCode', () => {
  test('embeds the loaded website UUID when the page param is a short site number', () => {
    websiteMock.mockReturnValue({
      id: '0f83d5de-2d3d-4a1b-8f53-11e5e8c79001',
      siteNumber: 101,
    });

    render(<WebsiteTrackingCode websiteId="101" />, { route: 'https://localhost:3000' });

    const code = screen.getByDisplayValue(/data-website-id=/);
    expect(code).toHaveValue(
      '<script defer src="http://localhost:3000/script.js" data-website-id="0f83d5de-2d3d-4a1b-8f53-11e5e8c79001"></script>',
    );
  });

  test('falls back to the websiteId prop outside a website context', () => {
    websiteMock.mockReturnValue(null);

    render(
      <WebsiteTrackingCode websiteId="0f83d5de-2d3d-4a1b-8f53-11e5e8c79001" showHeader={false} />,
      { route: 'https://localhost:3000' },
    );

    const code = screen.getByDisplayValue(/data-website-id=/);
    expect(code).toHaveValue(
      '<script defer src="http://localhost:3000/script.js" data-website-id="0f83d5de-2d3d-4a1b-8f53-11e5e8c79001"></script>',
    );
  });
});
