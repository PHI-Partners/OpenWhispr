import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { storeResetFns, teardown } from '../helpers/renderWithApp';
import { resetRecordingStore } from '@/stores/useRecordingStore';

storeResetFns.add(resetRecordingStore);

afterEach(teardown);
