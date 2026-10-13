# 自愿支持素材与使用边界

根据本次 BesMapLab 项目的实施要求，两张收款原图从 BesFuel 的 `resources/support/` 逐字节复制到本项目的同名目录，并由构建脚本内嵌到单文件页面。这样直接打开 `index.html` 时也能查看、保存原图，不依赖网络请求。

| 文件 | 原始来源 | SHA-256 | 图片可见收款主体 |
| --- | --- | --- | --- |
| `resources/support/wechat.png` | BesFuel `resources/support/wechat.png` | `a89ad9f33ecc5b9bc6a6bf5587fa16cd04809d3bfbcaac58a0731faceae41449` | `Benson(**城)` |
| `resources/support/alipay.png` | BesFuel `resources/support/alipay.png` | `5f5722d5a30ecbd5d51684a2051eb40961070c8954a2f3b3eef403f526f367d4` | `Bes软件` |

收款图片用于 BesMapLab 的自愿支持入口。图片并不因项目代码采用 MIT 许可而自动允许第三方复制到自己的收款页面。页面展示原图，不裁剪、重绘或替换二维码与收款主体。

支持入口只在用户点击后打开，不预设金额、不建立订单、不检测付款、不解锁功能。展示中的图案仅是地图主题装饰，不表示打赏进度或付款成功。付款前应在支付应用中核对实际收款人；图片能否被微信和支付宝识别仍需用真实手机分别核验。
