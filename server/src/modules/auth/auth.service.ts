import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../rbac/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async login(username: string, password: string) {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user || user.disabled) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid username or password');
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });
    const permissions = new Set<string>();
    for (const role of user.roles ?? []) {
      for (const permission of role.permissions ?? []) {
        permissions.add(permission.code);
      }
    }
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: (user.roles ?? []).map((r) => r.code),
        perms: [...permissions],
      },
    };
  }
}
