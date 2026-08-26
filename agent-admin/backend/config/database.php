<?php

return [
    'default' => env('DB_CONNECTION', 'mysql'),

    'connections' => [
        'mysql' => [
            'driver' => 'mysql',
            'url' => env('DATABASE_URL'),
            'host' => env('DB_HOST', '127.0.0.1'),
            'port' => env('DB_PORT', '3306'),
            'database' => env('DB_DATABASE', 'agent_admin'),
            'username' => env('DB_USERNAME', 'root'),
            'password' => env('DB_PASSWORD', ''),
            'unix_socket' => env('DB_SOCKET', ''),
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
            'prefix_indexes' => true,
            'strict' => false,
            'engine' => 'InnoDB',
        ],

        // 文档 RAG 向量索引专用 SQLite 二级连接
        // 单文件 storage/app/docs-vectors.db，与主库完全解耦：
        //   - 主库（mysql）只存业务元数据（doc_chunks 行 + chunk_text + 元信息）
        //   - 本库存向量索引（vec0 虚拟表 / 普通 cosine 兜底表）
        // 通过 doc_chunks.id 作为跨库主键关联，备份/重建/迁移都走 .db 单文件
        'docvec' => [
            'driver' => 'sqlite',
            'url' => env('DOCVEC_URL'),
            'database' => env('DOCVEC_DATABASE', storage_path('app/docs-vectors.db')),
            'prefix' => '',
            'foreign_key_constraints' => env('DOCVEC_FOREIGN_KEYS', false),
        ],
    ],

    'migrations' => 'migrations',
];
