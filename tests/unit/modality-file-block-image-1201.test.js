import { describe, it, expect } from 'vitest';
import { stripUnsupportedModalities } from '../../open-sse/translator/concerns/modality.js';
import { detectRequiredCapabilities } from '../../open-sse/services/combo.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// pdf is false on every model in the capability table but one, so a block
// classified as a document is stripped even from a model chosen for its vision.
const VISION_NO_PDF = { vision: true, audioInput: true, pdf: false };
const NO_VISION = { vision: false, audioInput: true, pdf: true };
const NO_PDF_NO_VISION = { vision: false, audioInput: true, pdf: false };

const imageFileBlock = () => ({
  type: 'file',
  file: { filename: 'shot.png', file_data: 'data:image/png;base64,AAAA' },
});
const pdfFileBlock = () => ({
  type: 'file',
  file: { filename: 'spec.pdf', file_data: 'data:application/pdf;base64,AAAA' },
});

const types = (body) => body.messages[0].content.map((b) => b.type);
const placeholders = (body) =>
  body.messages[0].content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ');

// combo.js picks the model from the mime inside the block; modality.js decided
// from the block type alone and called every file a document. An image shipped
// as a file block was therefore routed TO a vision model and then removed as an
// unsupported document — the silent image loss behind #1302 / #1201.
describe('routing and stripping agree on what a file block is (#1302, #1201)', () => {
  it('combo.js requires vision, not pdf, for an image in a file block', () => {
    const required = detectRequiredCapabilities({
      messages: [{ role: 'user', content: [imageFileBlock()] }],
    });
    expect(required.has('vision')).toBe(true);
    expect(required.has('pdf')).toBe(false);
  });

  it('keeps an image file block on a vision model that cannot read PDFs', () => {
    const body = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'what is this' }, imageFileBlock()] },
      ],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, VISION_NO_PDF);
    expect(types(body)).toContain('file');
    expect(placeholders(body)).not.toMatch(/omitted/);
  });

  it('still strips a real PDF from a model that cannot read one', () => {
    const body = { messages: [{ role: 'user', content: [pdfFileBlock()] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, VISION_NO_PDF);
    expect(types(body)).not.toContain('file');
    expect(placeholders(body)).toMatch(/file omitted/);
  });

  it('strips an image file block from a model with no vision, as an image', () => {
    const body = { messages: [{ role: 'user', content: [imageFileBlock()] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI, NO_PDF_NO_VISION);
    expect(types(body)).not.toContain('file');
    expect(placeholders(body)).toMatch(/image omitted/);
    expect(placeholders(body)).not.toMatch(/file omitted/);
  });

  it('claude: a document block carrying an image follows vision, not pdf', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
            },
          ],
        },
      ],
    };
    stripUnsupportedModalities(body, FORMATS.CLAUDE, VISION_NO_PDF);
    expect(types(body)).toContain('document');
  });

  it('a file block with no mime keeps the old document answer', () => {
    const body = {
      messages: [{ role: 'user', content: [{ type: 'file', file: { filename: 'notes' } }] }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, VISION_NO_PDF);
    expect(types(body)).not.toContain('file');
    expect(placeholders(body)).toMatch(/file omitted/);
  });
});

// combo.js counts these toward the vision requirement. modality.js did not
// strip them, so when the turn did land on a model with no vision the image
// went upstream and came back a 400 instead of a placeholder (#1269).
describe('every shape routing counts as an image is also strippable (#1269)', () => {
  it('strips input_image blocks sent on chat messages', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }],
        },
      ],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, NO_VISION);
    expect(types(body)).not.toContain('input_image');
    expect(placeholders(body)).toMatch(/image omitted/);
  });

  it('drops message-level image_url / image properties', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: 'look',
          image_url: 'data:image/png;base64,AAAA',
          image: 'data:image/png;base64,AAAA',
        },
      ],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, NO_VISION);
    expect(body.messages[0].image_url).toBeUndefined();
    expect(body.messages[0].image).toBeUndefined();
    expect(detectRequiredCapabilities(body).has('vision')).toBe(false);
  });

  it('leaves those properties alone on a model that can see', () => {
    const body = {
      messages: [{ role: 'user', content: 'look', image_url: 'data:image/png;base64,AAAA' }],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI, VISION_NO_PDF);
    expect(body.messages[0].image_url).toBe('data:image/png;base64,AAAA');
  });

  it('responses: input_file carrying an image follows vision', () => {
    const body = {
      input: [
        {
          role: 'user',
          content: [{ type: 'input_file', file: { file_data: 'data:image/png;base64,AAAA' } }],
        },
      ],
    };
    stripUnsupportedModalities(body, FORMATS.OPENAI_RESPONSES, VISION_NO_PDF);
    expect(body.input[0].content.map((b) => b.type)).toContain('input_file');
  });

  it('responses: input_image is still stripped when vision is off', () => {
    const body = { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'x' }] }] };
    stripUnsupportedModalities(body, FORMATS.OPENAI_RESPONSES, NO_VISION);
    const kinds = body.input[0].content.map((b) => b.type);
    expect(kinds).not.toContain('input_image');
    expect(kinds).toContain('input_text');
  });
});
