import { ArgumentMetadata } from '@nestjs/common';
import {
  createZodDto,
  ZodSchemaDeclarationException,
  ZodValidationException,
} from 'nestjs-zod';
import { z } from 'zod';
import { StrictZodValidationPipe } from './strict-zod-validation.pipe';

const testSchema = z.object({ name: z.string() });
class TestBodyDto extends createZodDto(testSchema) {}

describe('StrictZodValidationPipe', () => {
  const pipe = new StrictZodValidationPipe();

  it('passes through custom decorator parameters', () => {
    const value = { sub: 'user-1' };
    const metadata: ArgumentMetadata = { type: 'custom', metatype: Object };

    expect(pipe.transform(value, metadata)).toBe(value);
  });

  it.each(['body', 'query', 'param'] as const)(
    'throws when %s lacks a Zod DTO',
    (type) => {
      const metadata: ArgumentMetadata = { type, metatype: Object };

      expect(() => pipe.transform({ name: 'x' }, metadata)).toThrow(
        ZodSchemaDeclarationException,
      );
    },
  );

  it.each(['body', 'query', 'param'] as const)(
    'validates %s values with a declared Zod DTO',
    (type) => {
      const metadata: ArgumentMetadata = {
        type,
        metatype: TestBodyDto,
      };

      expect(pipe.transform({ name: 'Ada' }, metadata)).toEqual({
        name: 'Ada',
      });
    },
  );

  it('rejects invalid body values with ZodValidationException', () => {
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: TestBodyDto,
    };

    expect(() => pipe.transform({ name: 42 }, metadata)).toThrow(
      ZodValidationException,
    );
  });
});
