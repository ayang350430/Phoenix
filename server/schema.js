import db from './db.js'

export async function ensureSchema() {
  // 1. users
  if (!(await db.schema.hasTable('users'))) {
    await db.schema.createTable('users', t => {
      t.increments('id').unsigned()
      t.string('username', 255).notNullable().unique()
      t.string('email', 255).nullable()
      t.string('password_hash', 255).notNullable()
      t.string('real_name', 255).nullable()
      t.string('nickname', 255).nullable()
      t.string('status', 20).notNullable().defaultTo('active')
      t.string('referral_code', 16).nullable().unique()
      t.integer('referred_by').unsigned().nullable()
      t.boolean('order_view_enabled').nullable()
      t.boolean('order_like_enabled').nullable()
      t.boolean('order_impression_enabled').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: users')
  }

  if (!(await db.schema.hasColumn('users', 'token_version'))) {
    await db.schema.alterTable('users', t => {
      t.integer('token_version').unsigned().notNullable().defaultTo(1)
    })
    console.log('  [SCHEMA] Added column: users.token_version')
  }

  // 2. roles
  if (!(await db.schema.hasTable('roles'))) {
    await db.schema.createTable('roles', t => {
      t.increments('id').unsigned()
      t.string('code', 100).notNullable()
      t.string('name', 255).notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: roles')
  }

  // 3. user_roles
  if (!(await db.schema.hasTable('user_roles'))) {
    await db.schema.createTable('user_roles', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable()
      t.integer('role_id').unsigned().notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.unique(['user_id', 'role_id'])
    })
    console.log('  [SCHEMA] Created table: user_roles')
  }

  // 4. permissions
  if (!(await db.schema.hasTable('permissions'))) {
    await db.schema.createTable('permissions', t => {
      t.increments('id').unsigned()
      t.string('code', 100).notNullable()
      t.string('name', 255).notNullable()
    })
    console.log('  [SCHEMA] Created table: permissions')
  }

  // 5. role_permissions
  if (!(await db.schema.hasTable('role_permissions'))) {
    await db.schema.createTable('role_permissions', t => {
      t.increments('id').unsigned()
      t.integer('role_id').unsigned().notNullable()
      t.integer('permission_id').unsigned().notNullable()
    })
    console.log('  [SCHEMA] Created table: role_permissions')
  }

  // 6. products
  if (!(await db.schema.hasTable('products'))) {
    await db.schema.createTable('products', t => {
      t.increments('id').unsigned()
      t.string('name', 100).notNullable()
      t.string('target_type', 30).notNullable()
      t.decimal('unit_price', 10, 4).notNullable().defaultTo(0.01)
      t.integer('min_quantity').notNullable().defaultTo(100)
      t.integer('max_quantity').notNullable().defaultTo(100000)
      t.integer('step_quantity').notNullable().defaultTo(100)
      t.string('status', 20).notNullable().defaultTo('on')
      t.string('description', 500).nullable().defaultTo('')
      t.string('icon', 20).nullable().defaultTo('')
      t.string('color', 30).nullable().defaultTo('')
      t.integer('sort_order').notNullable().defaultTo(0)
      t.string('api_endpoint', 255).nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: products')
  }

  // 7. order_batches
  if (!(await db.schema.hasTable('order_batches'))) {
    await db.schema.createTable('order_batches', t => {
      t.increments('id').unsigned()
      t.string('batch_id', 36).nullable()
      t.string('batch_no', 50).notNullable()
      t.integer('user_id').unsigned().notNullable()
      t.string('source_type', 30).nullable()
      t.string('submit_mode', 30).nullable()
      t.text('raw_content', 'longtext').nullable()
      t.string('status', 20).notNullable().defaultTo('pending')
      t.integer('total_count').unsigned().defaultTo(0)
      t.integer('pending_count').unsigned().defaultTo(0)
      t.integer('processing_count').unsigned().defaultTo(0)
      t.integer('succeeded_count').unsigned().defaultTo(0)
      t.integer('failed_count').unsigned().defaultTo(0)
      t.integer('retryable_count').unsigned().defaultTo(0)
      t.decimal('estimated_amount', 14, 4).defaultTo(0)
      t.boolean('has_upstream').nullable().defaultTo(true)
      t.timestamp('submitted_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: order_batches')
  }

  // 8. orders
  if (!(await db.schema.hasTable('orders'))) {
    await db.schema.createTable('orders', t => {
      t.increments('id').unsigned()
      t.string('order_no', 100).notNullable()
      t.integer('user_id').unsigned().notNullable()
      t.integer('batch_id').unsigned().notNullable()
      t.integer('batch_item_id').nullable()
      t.integer('product_id').unsigned().nullable()
      t.string('note_id', 255).nullable()
      t.string('note_url', 500).nullable()
      t.string('title', 500).nullable()
      t.string('target_type', 30).notNullable()
      t.string('author_id', 255).nullable()
      t.string('author_name', 255).nullable()
      t.string('avatar_url', 500).nullable()
      t.integer('like_count').unsigned().nullable()
      t.integer('ordered_quantity').unsigned().notNullable()
      t.integer('completed_quantity').unsigned().defaultTo(0)
      t.integer('refunded_quantity').unsigned().defaultTo(0)
      t.string('order_status', 30).notNullable().defaultTo('pending')
      t.string('external_task_id', 255).nullable()
      t.string('external_status', 30).nullable()
      t.integer('external_progress').unsigned().defaultTo(0)
      t.integer('external_completed_quantity').unsigned().defaultTo(0)
      t.timestamp('external_last_synced_at').nullable()
      t.integer('snapshot_current_read_count').unsigned().nullable()
      t.text('snapshot_current_read_payload', 'longtext').nullable()
      t.text('snapshot_current_like_payload', 'longtext').nullable()
      t.integer('snapshot_verified_read_count').unsigned().nullable()
      t.integer('snapshot_verified_like_count').unsigned().nullable()
      t.timestamp('last_verified_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
      t.index('batch_id')
      t.index('user_id')
      t.index('order_status')
    })
    console.log('  [SCHEMA] Created table: orders')
  }

  // 9. balance_accounts
  if (!(await db.schema.hasTable('balance_accounts'))) {
    await db.schema.createTable('balance_accounts', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable().unique()
      t.decimal('available_amount', 14, 4).defaultTo(0)
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: balance_accounts')
  }

  // 10. account_records
  if (!(await db.schema.hasTable('account_records'))) {
    await db.schema.createTable('account_records', t => {
      t.increments('id').unsigned()
      t.string('record_no', 100).notNullable()
      t.integer('user_id').unsigned().notNullable()
      t.string('record_type', 30).notNullable()
      t.string('direction', 10).notNullable()
      t.integer('order_id').unsigned().nullable()
      t.string('order_no', 100).nullable()
      t.string('status', 20).notNullable().defaultTo('success')
      t.integer('ordered_quantity').unsigned().nullable()
      t.decimal('original_unit_price', 10, 4).nullable()
      t.decimal('original_total_amount', 14, 4).nullable()
      t.decimal('discount_rate', 5, 4).nullable()
      t.decimal('discounted_unit_price', 10, 4).nullable()
      t.decimal('discount_amount', 14, 4).nullable()
      t.decimal('payable_amount', 14, 4).nullable()
      t.decimal('actual_paid_amount', 14, 4).nullable()
      t.decimal('refund_amount', 14, 4).nullable()
      t.decimal('net_amount', 14, 4).nullable()
      t.decimal('before_available_amount', 14, 4).nullable()
      t.decimal('after_available_amount', 14, 4).nullable()
      t.string('reason_message', 500).nullable()
      t.string('remark', 500).nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.index('user_id')
    })
    console.log('  [SCHEMA] Created table: account_records')
  }

  // 11. system_configs
  if (!(await db.schema.hasTable('system_configs'))) {
    await db.schema.createTable('system_configs', t => {
      t.increments('id').unsigned()
      t.string('config_key', 100).notNullable().unique()
      t.text('config_value', 'longtext').nullable()
      t.string('config_group', 50).nullable()
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: system_configs')
  }

  // 12. chat_conversations
  if (!(await db.schema.hasTable('chat_conversations'))) {
    await db.schema.createTable('chat_conversations', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable()
      t.string('visitor_id', 64).nullable()
      t.string('visitor_name', 100).nullable()
      t.string('status', 20).defaultTo('open')
      t.integer('assigned_to').unsigned().nullable()
      t.integer('owner_id').unsigned().nullable()
      t.string('last_message', 100).nullable()
      t.integer('unread_count').unsigned().defaultTo(0)
      t.timestamp('last_message_at').defaultTo(db.fn.now())
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: chat_conversations')
  }

  // 13. chat_messages
  if (!(await db.schema.hasTable('chat_messages'))) {
    await db.schema.createTable('chat_messages', t => {
      t.increments('id').unsigned()
      t.integer('conversation_id').unsigned().notNullable()
      t.integer('sender_id').unsigned().notNullable()
      t.string('sender_role', 20).notNullable()
      t.string('type', 20).defaultTo('text')
      t.text('content', 'mediumtext').notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.index('conversation_id')
      t.charset('utf8mb4')
      t.collate('utf8mb4_unicode_ci')
    })
    console.log('  [SCHEMA] Created table: chat_messages')
  }

  // 14. agent_prices
  if (!(await db.schema.hasTable('agent_prices'))) {
    await db.schema.createTable('agent_prices', t => {
      t.increments('id').unsigned()
      t.integer('agent_id').unsigned().notNullable()
      t.integer('product_id').unsigned().notNullable()
      t.decimal('sell_price', 10, 4).notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
      t.unique(['agent_id', 'product_id'])
    })
    console.log('  [SCHEMA] Created table: agent_prices')
  }

  // 15. user_prices
  if (!(await db.schema.hasTable('user_prices'))) {
    await db.schema.createTable('user_prices', t => {
      t.increments('id').unsigned()
      t.integer('agent_id').unsigned().notNullable()
      t.integer('user_id').unsigned().notNullable()
      t.integer('product_id').unsigned().notNullable()
      t.decimal('sell_price', 10, 4).notNullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
      t.unique(['user_id', 'product_id'])
    })
    console.log('  [SCHEMA] Created table: user_prices')
  }

  // 16. refund_requests
  if (!(await db.schema.hasTable('refund_requests'))) {
    await db.schema.createTable('refund_requests', t => {
      t.increments('id').unsigned()
      t.integer('batch_id').unsigned().notNullable()
      t.integer('order_id').unsigned().nullable()
      t.integer('user_id').unsigned().notNullable()
      t.decimal('refund_amount', 14, 4).defaultTo(0)
      t.string('status', 20).defaultTo('pending')
      t.text('reason').nullable()
      t.integer('reviewed_by').unsigned().nullable()
      t.text('review_remark').nullable()
      t.timestamp('reviewed_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.index('user_id')
      t.index('batch_id')
      t.index('status')
    })
    console.log('  [SCHEMA] Created table: refund_requests')
  }

  // 17. order_replenishment_records
  if (!(await db.schema.hasTable('order_replenishment_records'))) {
    await db.schema.createTable('order_replenishment_records', t => {
      t.increments('id').unsigned()
      t.string('replenishment_no', 100).notNullable()
      t.integer('order_id').unsigned().notNullable()
      t.string('order_no', 100).notNullable()
      t.integer('batch_id').unsigned().notNullable()
      t.integer('user_id').unsigned().notNullable()
      t.string('target_type', 30).notNullable()
      t.string('note_id', 255).nullable()
      t.string('note_url', 500).nullable()
      t.string('original_external_task_id', 255).nullable()
      t.integer('ordered_quantity').unsigned().notNullable()
      t.integer('actual_quantity').unsigned().notNullable()
      t.integer('shortage_quantity').unsigned().notNullable()
      t.integer('snapshot_before_count').unsigned().nullable()
      t.integer('snapshot_after_count').unsigned().nullable()
      t.string('status', 20).defaultTo('pending')
      t.text('reason_message').nullable()
      t.timestamp('requested_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: order_replenishment_records')
  }

  // 18. recharge_orders
  if (!(await db.schema.hasTable('recharge_orders'))) {
    await db.schema.createTable('recharge_orders', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable()
      t.string('merchant_order_id', 100).notNullable()
      t.string('order_no', 100).notNullable()
      t.decimal('amount', 14, 4).notNullable()
      t.string('currency', 10).notNullable().defaultTo('CNY')
      t.string('status', 20).defaultTo('pending')
      t.string('payment_url', 500).nullable()
      t.timestamp('expired_at').nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
      t.timestamp('updated_at').nullable()
    })
    console.log('  [SCHEMA] Created table: recharge_orders')
  }

  // 19. batch_link_check_records
  if (!(await db.schema.hasTable('batch_link_check_records'))) {
    await db.schema.createTable('batch_link_check_records', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable()
      t.string('check_batch_no', 100).notNullable()
      t.integer('line_no').unsigned().notNullable()
      t.string('note_url', 500).nullable()
      t.string('note_id', 255).nullable()
      t.string('status', 20).defaultTo('ok')
      t.string('message', 500).nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: batch_link_check_records')
  }

  // 20. batch_problem_link_records
  if (!(await db.schema.hasTable('batch_problem_link_records'))) {
    await db.schema.createTable('batch_problem_link_records', t => {
      t.increments('id').unsigned()
      t.integer('user_id').unsigned().notNullable()
      t.string('check_batch_no', 100).notNullable()
      t.string('note_url', 500).nullable()
      t.string('note_id', 255).nullable()
      t.string('reason', 500).nullable()
      t.timestamp('created_at').defaultTo(db.fn.now())
    })
    console.log('  [SCHEMA] Created table: batch_problem_link_records')
  }

  console.log('  [SCHEMA] All tables verified.')
}
