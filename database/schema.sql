CREATE DATABASE IF NOT EXISTS zalo_crm
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE zalo_crm;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(191) NOT NULL UNIQUE,
  display_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS zalo_accounts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  zalo_user_id VARCHAR(100) NOT NULL,
  zalo_name VARCHAR(255) NULL,
  credential_ciphertext LONGTEXT NULL,
  status ENUM('CONNECTED','DISCONNECTED','EXPIRED','LOGIN_PENDING') NOT NULL DEFAULT 'DISCONNECTED',
  last_connected_at DATETIME NULL,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_zalo_user_id (zalo_user_id),
  CONSTRAINT fk_zalo_account_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    zalo_account_id BIGINT UNSIGNED NOT NULL,
    zalo_user_id VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NULL,
    phone VARCHAR(40) NULL,
    status ENUM(
        'ACTIVE',
        'BLOCKED',
        'INACTIVE'
    ) NOT NULL DEFAULT 'ACTIVE',

    note TEXT NULL,
    first_interaction_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interaction_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_customer_account_user (
        zalo_account_id,
        zalo_user_id
    ),
    KEY idx_customer_phone (phone),
    KEY idx_customer_name (display_name),
    KEY idx_customer_status (status),
    KEY idx_customer_last_interaction (last_interaction_at),
    CONSTRAINT fk_customer_zalo_account
        FOREIGN KEY (zalo_account_id)
        REFERENCES zalo_accounts(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_tags (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_customer_tag_name (name)

) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customer_tag_relations (
    customer_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (customer_id, tag_id),

    CONSTRAINT fk_ctr_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_ctr_tag
        FOREIGN KEY (tag_id)
        REFERENCES customer_tags(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS campaigns (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    zalo_account_id BIGINT UNSIGNED NOT NULL,

    name VARCHAR(255) NOT NULL,

    content TEXT NOT NULL,

    status ENUM(
        'DRAFT',
        'SCHEDULED',
        'RUNNING',
        'COMPLETED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'DRAFT',

    scheduled_at DATETIME NULL,

    started_at DATETIME NULL,
    completed_at DATETIME NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    KEY idx_campaign_account (zalo_account_id),
    KEY idx_campaign_status (status),
    KEY idx_campaign_scheduled (scheduled_at),

    CONSTRAINT fk_campaign_zalo_account
        FOREIGN KEY (zalo_account_id)
        REFERENCES zalo_accounts(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS campaign_customers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    campaign_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,

    status ENUM(
        'PENDING',
        'SENDING',
        'SENT',
        'FAILED',
        'SKIPPED'
    ) NOT NULL DEFAULT 'PENDING',

    sent_at DATETIME NULL,

    error_message TEXT NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_campaign_customer (
        campaign_id,
        customer_id
    ),

    KEY idx_campaign_customer_status (status),
    KEY idx_campaign_customer_customer (customer_id),

    CONSTRAINT fk_cc_campaign
        FOREIGN KEY (campaign_id)
        REFERENCES campaigns(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_cc_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE

) ENGINE=InnoDB;