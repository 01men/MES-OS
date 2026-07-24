import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { BizException } from '../../common/exceptions';
import { ALLOWED_IMAGE_EXT, UPLOAD_ROOT, yyyymm } from './upload.util';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function sanitize(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(-60) || 'file';
}

/**
 * 通用文件上传（前端 PhotoCapture 组件契约）。
 * POST /api/common/upload：multipart 字段名 file；可选表单字段 docNo/photoType
 * —— 发货照片按「发货单号_类型_毫秒时间戳.jpg」命名；按年月归档 data/uploads/YYYYMM/。
 */
@Controller('common')
export class CommonUploadController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = path.join(UPLOAD_ROOT, yyyymm());
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const { docNo, photoType } = (req.body ?? {}) as { docNo?: string; photoType?: string };
          const base =
            docNo && photoType
              ? `${sanitize(docNo)}_${sanitize(photoType)}_${Date.now()}`
              : `${Date.now()}_${sanitize(path.basename(file.originalname, ext))}`;
          cb(null, `${base}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const ok = ALLOWED_IMAGE_EXT.includes(ext) && /^image\/(jpeg|png)$/.test(file.mimetype);
        if (ok) cb(null, true);
        else cb(new BizException('INVALID_FILE_TYPE', `仅支持 jpg/jpeg/png，收到 ${file.originalname}`) as any, false);
      },
    }),
  )
  upload(@UploadedFile() file: any) {
    if (!file) throw new BizException('FILE_REQUIRED', 'multipart 字段 file 必填');
    if (!file.size || file.size <= 0) {
      fs.rmSync(file.path, { force: true });
      throw new BizException('FILE_EMPTY', '空文件不允许上传');
    }
    const ym = path.basename(file.destination);
    return {
      url: `/api/common/files/${ym}/${file.filename}`,
      fileName: file.filename,
      size: file.size,
    };
  }

  /** 上传文件访问（登录即可，MVP） */
  @Get('files/:ym/:name')
  download(@Param('ym') ym: string, @Param('name') name: string, @Res() res: Response) {
    if (!/^\d{6}$/.test(ym) || !/^[\w.-]+$/.test(name)) {
      throw new NotFoundException('file not found');
    }
    const p = path.join(UPLOAD_ROOT, ym, name);
    if (!p.startsWith(UPLOAD_ROOT) || !fs.existsSync(p)) {
      throw new NotFoundException('file not found');
    }
    const ext = path.extname(name).toLowerCase();
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
    fs.createReadStream(p).pipe(res);
  }
}
