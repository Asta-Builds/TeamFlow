import { ConfigModule } from '@nestjs/config';
import { requireSecret } from './security.js';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: () => {
        const secret = requireSecret('JWT_SECRET');
        const refreshSecret = requireSecret('JWT_REFRESH_SECRET');
        if (secret === refreshSecret)
          throw new Error('Access and refresh secrets must differ');
        return {
          secret,
          signOptions: {
            expiresIn: '1d' as const,
            algorithm: 'HS256' as const,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule, JwtModule],
})
export class AuthModule {}
