from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AppRegistry, app_to_dict
from ..config import PM_PLATFORM_URL, PROBLEM_HUB_URL

router = APIRouter(prefix="/api/apps", tags=["apps"])


class AppCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,62}$")
    name: str = Field(min_length=2, max_length=128)
    description: str = Field(min_length=5, max_length=2000)
    category: str = Field(min_length=2, max_length=64)
    icon: str = Field(default="appDefault", max_length=64)
    owner: str = Field(default="平台管理员", max_length=64)
    template_type: str = Field(default="custom", max_length=64)


def _builtin_apps() -> list[dict]:
    return [
        {"id": "problems", "name": "AI + 问题经验", "description": "问题经验库、Excel 智能导入与整改闭环。", "category": "质量与经验", "icon": "problems", "status": "active", "route_path": "problems", "owner": "质量团队", "is_core": 1, "entry_url": PROBLEM_HUB_URL or None, "evidence_note": "本平台内置导入试点；完整企业版为独立系统，入口需由部署配置提供。"},
        {"id": "projects", "name": "AI + 项目管理", "description": "项目组合、DCP 里程碑、风险闭环与周报导出。", "category": "项目运营", "icon": "projects", "status": "active", "route_path": "projects", "owner": "PMO", "is_core": 1, "entry_url": PM_PLATFORM_URL or None, "evidence_note": "本门户提供本地项目管理试点；配置 PM_PLATFORM_URL 后可跳转独立项目管理系统，本地数据与独立系统数据分离。"},
        {"id": "standardization", "name": "AI + 标准化与优选件", "description": "物料目录、相似件检索、BOM 合规校验与优选件推荐。", "category": "标准化", "icon": "standardization", "status": "active", "route_path": "standardization", "owner": "标准化团队", "is_core": 1, "entry_url": None, "evidence_note": "本地物料库与确定性规则已可试用；PLM 尚未接入，正式替代/放行仍需工程师复核。"},
        {"id": "quality-assistant", "name": "质量决策助手", "description": "面向质量数据的受控查询、证据引用与人工审核。", "category": "质量决策", "icon": "problems", "status": "planned", "route_path": "quality-assistant", "owner": "质量团队", "is_core": 1, "entry_url": None, "evidence_note": "待质量库接口、算力和权限方案明确后启动。"},
    ]


def _seed_builtin_apps(db: Session) -> None:
    for values in _builtin_apps():
        app = db.get(AppRegistry, values["id"])
        if app is None:
            db.add(AppRegistry(template_type="builtin", version="0.2.0", **values))
        elif app.is_core:
            # 内置模块元数据跟随代码更新；用户自建模块绝不覆盖。
            for key, value in values.items():
                setattr(app, key, value)
    db.commit()

@router.get("")
def list_apps(db: Session = Depends(get_db)):
    _seed_builtin_apps(db)
    apps = db.query(AppRegistry).order_by(AppRegistry.created_at).all()
    return {"items": [app_to_dict(a) for a in apps]}

@router.post("", status_code=status.HTTP_201_CREATED)
def create_app(payload: AppCreate, db: Session = Depends(get_db)):
    if db.query(AppRegistry).filter(AppRegistry.id == payload.id).first():
        raise HTTPException(status_code=400, detail="应用 ID 已存在")
        
    new_app = AppRegistry(
        id=payload.id,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        icon=payload.icon,
        status="draft", # 新应用默认草稿状态
        route_path=payload.id,
        template_type=payload.template_type,
        owner=payload.owner,
        is_core=0
    )
    db.add(new_app)
    db.commit()
    return app_to_dict(new_app)
