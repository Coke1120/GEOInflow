import { processSingleton } from './process-singleton';

export const LiekanError = processSingleton(
  'liekan-error',
  () =>
    class LiekanError extends Error {
      constructor(
        message: string,
        public status = 400,
        public code = 'liekan-error',
      ) {
        super(message);
      }
    },
);
export type LiekanError = InstanceType<typeof LiekanError>;
