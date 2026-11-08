import {
  OnnxEmbeddingProvider,
  ONNX_EMBEDDING_DIM,
} from '../src/modules/smart-cache/onnxEmbedding.js';
import {
  cosineSimilarity,
  createEmbeddingProvider,
} from '../src/modules/smart-cache/embeddings.js';

describe('OnnxEmbeddingProvider (Offline Vector Semantic Cache)', () => {
  it('generates 384-dimensional unit vectors in offline mode', async () => {
    const provider = new OnnxEmbeddingProvider();
    const vec = await provider.embed('fix user authentication session bug in server.ts');

    expect(vec).toHaveLength(ONNX_EMBEDDING_DIM);

    // Verify unit length (L2 norm ≈ 1)
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('yields high cosine similarity for semantically close phrases', async () => {
    const provider = new OnnxEmbeddingProvider();

    const v1 = await provider.embed('user authentication token session');
    const v2 = await provider.embed('user login credentials authentication token');
    const v3 = await provider.embed('unrelated docker container build kubernetes pod');

    const simClose = cosineSimilarity(v1, v2);
    const simFar = cosineSimilarity(v1, v3);

    expect(simClose).toBeGreaterThan(0.5);
    expect(simClose).toBeGreaterThan(simFar);
  });

  it('createEmbeddingProvider instantiates onnx provider when requested', async () => {
    const provider = createEmbeddingProvider({ provider: 'onnx' });
    expect(provider.name).toBe('onnx-local');

    const vec = await provider.embed('test query');
    expect(vec).toHaveLength(ONNX_EMBEDDING_DIM);
  });
});
