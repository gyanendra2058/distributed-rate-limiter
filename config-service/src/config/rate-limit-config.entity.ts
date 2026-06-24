import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rate_limit_configs')
export class RateLimitConfigEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  endpoint: string;

  @Column({ type: 'int' })
  maxTokens: number;

  @Column({ type: 'int' })
  refillRate: number;

  @Column({ type: 'varchar', length: 16, default: 'second' })
  refillRateUnit: 'second' | 'minute' | 'hour';

  @Column({ type: 'int' })
  windowSizeMs: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
