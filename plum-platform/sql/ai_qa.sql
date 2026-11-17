-- AI 问答域 MySQL 建表脚本（MySQL 5.7+ / 8.0+ / MariaDB 10.2+）
-- 执行方式一（推荐）：配好 ai.env 后运行 python tools/init_ai_db.py
-- 执行方式二：mysql -u root -p < sql/ai_qa.sql
-- 说明：库名默认 plum_ai；若在 ai.env 改了 MYSQL_DB，init_ai_db.py 会自动替换本文件中的库名。

CREATE DATABASE IF NOT EXISTS plum_ai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE plum_ai;

-- 一轮会话：session_id 由后端生成，前端原样带回即可续聊
CREATE TABLE IF NOT EXISTS ai_sessions (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  channel VARCHAR(24) NOT NULL DEFAULT 'web',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_sessions_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 问答会话';

-- 逐条消息：既用于多轮上下文，也用于事后追溯答案来源
CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  role VARCHAR(12) NOT NULL COMMENT 'user / assistant',
  content TEXT NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT '' COMMENT '知识库 / 平台实时数据 / 外部大模型',
  engine VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'local / llm',
  model VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  INDEX idx_messages_session (session_id, id),
  CONSTRAINT fk_messages_session FOREIGN KEY (session_id)
    REFERENCES ai_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 问答消息';

-- 外部模型调用审计：不记密钥、不记完整 prompt，只记结果与耗时
CREATE TABLE IF NOT EXISTS ai_call_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL DEFAULT '',
  question VARCHAR(300) NOT NULL DEFAULT '',
  ok TINYINT(1) NOT NULL DEFAULT 0,
  engine VARCHAR(16) NOT NULL DEFAULT '',
  model VARCHAR(64) NOT NULL DEFAULT '',
  latency_ms INT NOT NULL DEFAULT 0,
  error VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  INDEX idx_call_logs_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='外部大模型调用日志';

-- 预留：以后要放运行时开关（如限流阈值）时用，密钥永不入库
CREATE TABLE IF NOT EXISTS ai_settings (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  `value` TEXT,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 运行时配置';
