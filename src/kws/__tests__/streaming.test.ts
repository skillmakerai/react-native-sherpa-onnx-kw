import { createKeywordSpotter } from '../streaming';

const mockNative = {
  initializeKwsWithOptions: jest.fn(),
  createKwsStream: jest.fn(),
  acceptKwsWaveform: jest.fn(),
  decodeKwsStream: jest.fn(),
  isKwsStreamReady: jest.fn(),
  getKwsStreamResult: jest.fn(),
  resetKwsStream: jest.fn(),
  releaseKwsStream: jest.fn(),
  unloadKws: jest.fn(),
  processKwsAudioChunk: jest.fn(),
};

jest.mock('../../NativeSherpaOnnx', () => ({
  __esModule: true,
  default: {
    initializeKwsWithOptions: (...args: unknown[]) =>
      mockNative.initializeKwsWithOptions(...args),
    createKwsStream: (...args: unknown[]) =>
      mockNative.createKwsStream(...args),
    acceptKwsWaveform: (...args: unknown[]) =>
      mockNative.acceptKwsWaveform(...args),
    decodeKwsStream: (...args: unknown[]) =>
      mockNative.decodeKwsStream(...args),
    isKwsStreamReady: (...args: unknown[]) =>
      mockNative.isKwsStreamReady(...args),
    getKwsStreamResult: (...args: unknown[]) =>
      mockNative.getKwsStreamResult(...args),
    resetKwsStream: (...args: unknown[]) => mockNative.resetKwsStream(...args),
    releaseKwsStream: (...args: unknown[]) =>
      mockNative.releaseKwsStream(...args),
    unloadKws: (...args: unknown[]) => mockNative.unloadKws(...args),
    processKwsAudioChunk: (...args: unknown[]) =>
      mockNative.processKwsAudioChunk(...args),
  },
}));

jest.mock('../../utils', () => ({
  resolveModelPath: (config: { type: string; path: string }) =>
    Promise.resolve(`/resolved/${config.path}`),
}));

describe('createKeywordSpotter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNative.initializeKwsWithOptions.mockResolvedValue({ success: true });
    mockNative.createKwsStream.mockResolvedValue(undefined);
    mockNative.processKwsAudioChunk.mockResolvedValue({
      keyword: '',
      tokens: [],
      timestamps: [],
    });
  });

  it('flattens init options and forwards only defined values to native', async () => {
    await createKeywordSpotter({
      modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
      modelType: 'transducer',
      numThreads: 2,
      numTrailingBlanks: 1,
      keywordsScore: 1.5,
      keywordsThreshold: 0.25,
      maxActivePaths: 4,
    });

    expect(mockNative.initializeKwsWithOptions).toHaveBeenCalledTimes(1);
    const [instanceId, options] =
      mockNative.initializeKwsWithOptions.mock.calls[0];
    expect(typeof instanceId).toBe('string');
    expect(options).toEqual({
      modelDir: '/resolved/models/kws-zipformer-zh-en',
      modelType: 'transducer',
      numThreads: 2,
      numTrailingBlanks: 1,
      keywordsScore: 1.5,
      keywordsThreshold: 0.25,
      maxActivePaths: 4,
    });
  });

  it('omits undefined options to avoid iOS marshalling crash', async () => {
    await createKeywordSpotter({
      modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
    });

    const [, options] = mockNative.initializeKwsWithOptions.mock.calls[0];
    expect(options).toEqual({
      modelDir: '/resolved/models/kws-zipformer-zh-en',
      modelType: 'transducer',
    });
    expect('numThreads' in options).toBe(false);
    expect('keywordsScore' in options).toBe(false);
  });

  it('resolves a keywordsPath and forwards it as keywordsFile', async () => {
    await createKeywordSpotter({
      modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
      keywordsPath: { type: 'asset', path: 'models/kws/keywords.txt' },
    });

    const [, options] = mockNative.initializeKwsWithOptions.mock.calls[0];
    expect(options.keywordsFile).toBe('/resolved/models/kws/keywords.txt');
  });

  it('throws when native init reports failure', async () => {
    mockNative.initializeKwsWithOptions.mockResolvedValue({
      success: false,
      error: 'missing encoder',
    });

    await expect(
      createKeywordSpotter({
        modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
      })
    ).rejects.toThrow('missing encoder');
  });

  it('maps stream.processAudioChunk to native and normalizes the result', async () => {
    mockNative.processKwsAudioChunk.mockResolvedValue({
      keyword: 'HeyNapa',
      tokens: ['HH', 'EY1'],
      timestamps: [0.1, 0.2],
    });

    const engine = await createKeywordSpotter({
      modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
    });
    const stream = await engine.createStream();
    const result = await stream.processAudioChunk([0, 0.1, -0.1], 16000);

    expect(mockNative.processKwsAudioChunk).toHaveBeenCalledWith(
      expect.any(String),
      [0, 0.1, -0.1],
      16000
    );
    expect(result).toEqual({
      keyword: 'HeyNapa',
      tokens: ['HH', 'EY1'],
      timestamps: [0.1, 0.2],
    });
  });

  it('converts a Float32Array to a plain array before the bridge call', async () => {
    const engine = await createKeywordSpotter({
      modelPath: { type: 'asset', path: 'models/kws-zipformer-zh-en' },
    });
    const stream = await engine.createStream();
    await stream.processAudioChunk(new Float32Array([0, 0.5, -0.5]), 16000);

    const [, samples] = mockNative.processKwsAudioChunk.mock.calls[0];
    expect(Array.isArray(samples)).toBe(true);
    expect(samples).toEqual([0, 0.5, -0.5]);
  });
});
