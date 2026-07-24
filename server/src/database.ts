import * as fs from 'fs';
import * as path from 'path';
import { Type } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * 约定优于配置的自动发现：
 *  - 模块：扫描 src/modules/*\/ 下所有 *.module.(ts|js)，凡导出名为 *Module 的类一律注册；
 *  - 实体：扫描 src/common 与 src/modules 下所有 *.entity.(ts|js)。
 * 下游业务代理只需在自己模块目录新建文件，无需改动任何共享文件。
 *
 * 注意：发现基于运行时 fs+require，适用于 tsx 开发与 dist 生产运行；
 * Vitest 测试环境使用 test/helpers.ts 的静态清单（见 README）。
 */

function scanFiles(rootDir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) return out;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'node_modules') continue;
        walk(full);
      } else if (pattern.test(entry) && !entry.endsWith('.d.ts') && !entry.endsWith('.map')) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out.sort();
}

export function discoverModules(): Type[] {
  const modulesRoot = path.join(__dirname, 'modules');
  const result: Type[] = [];
  for (const dir of fs.existsSync(modulesRoot) ? fs.readdirSync(modulesRoot).sort() : []) {
    const dirPath = path.join(modulesRoot, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of scanFiles(dirPath, /\.module\.(ts|js)$/)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(file);
      for (const key of Object.keys(mod)) {
        if (key.endsWith('Module') && typeof mod[key] === 'function') {
          result.push(mod[key]);
        }
      }
    }
  }
  return result;
}

export function discoverEntities(): any[] {
  const roots = [path.join(__dirname, 'common'), path.join(__dirname, 'modules')];
  const result: any[] = [];
  for (const root of roots) {
    for (const file of scanFiles(root, /\.entity\.(ts|js)$/)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(file);
      for (const key of Object.keys(mod)) {
        if (typeof mod[key] === 'function') result.push(mod[key]);
      }
    }
  }
  return result;
}

/** 开发/生产库文件：server/data/mes.sqlite（npm scripts 的 cwd 为 server/） */
export const DB_FILE = path.resolve(process.cwd(), 'data', 'mes.sqlite');

export function buildTypeOrmOptions(inMemory = false): TypeOrmModuleOptions {
  const base = {
    type: 'sqljs' as const,
    synchronize: true, // MVP 阶段允许；生产必须关闭并改用 migration（见 README）
    entities: discoverEntities(),
    logging: false,
  };
  if (inMemory) return base as TypeOrmModuleOptions;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  return {
    ...base,
    location: DB_FILE,
    autoSave: true,
  } as TypeOrmModuleOptions;
}
