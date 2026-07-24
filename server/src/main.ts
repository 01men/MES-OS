import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/exceptions';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 全局前缀 /api；Mock U8 挂在 /mock-u8，不走全局前缀
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'mock-u8/purchase-orders', method: RequestMethod.GET },
      { path: 'mock-u8/delivery-notes', method: RequestMethod.GET },
      { path: 'mock-u8/master-data/:type', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors();
  await app.listen(3000);
  // eslint-disable-next-line no-console
  console.log('MES WMS server listening on http://localhost:3000 (api prefix /api, mock u8 at /mock-u8)');
}
bootstrap();
