import type { Preview } from '@storybook/nextjs';
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'win95-desktop',
      values: [
        { name: 'win95-desktop', value: '#008080' },
        { name: 'win95-face',    value: '#c0c0c0' },
        { name: 'white',         value: '#ffffff' },
      ],
    },
    layout: 'centered',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
