import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NumberingSequence } from './numbering.entity';
import { NumberingService } from './numbering.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NumberingSequence])],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
