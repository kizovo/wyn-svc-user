import * as C from '@/constant'
import * as dto from '@base/base.dto'
import * as lib from '@base/base.lib'
import {
  IDbFields,
  IDetailUserReq,
  IDeleteUserReq,
  IListUserReq,
  ISigninReq,
  ISignupReq,
  mapSignUpDb,
  mapFieldToJson,
} from '@/user/user.dto'

// list down all database field that safely expose to view, update & delete
const FIELD_LIST_USER: any = {
  uuid: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
}

const FIELD_DETAIL_USER: any = {
  uuid: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
}

const FIELD_SIGNIN_USER: any = {
  uuid: true,
  createdAt: true,
  password: true,
}

const calculatePage = (r: dto.IPaginationReq): dto.IPage => {
  const pg_num = Number(r.pg_num)
  const pg_size = Number(r.pg_size)
  const skip = pg_num - 1 >= 0 ? (pg_num - 1) * pg_size : 0
  return { pg_num, pg_size, skip }
}

const mapResult = (data: object): dto.IData => {
  const strData = JSON.stringify(data)
  const oData = JSON.parse(strData)
  return { data: oData, error: null }
}

const mapResultWithPagination = (pagination: object, data: object): dto.IDataPage => {
  const strData = JSON.stringify(data)
  const oData = JSON.parse(strData)
  return { pagination, data: oData, error: null }
}

export default class UserRepo {
  private dbMysql
  private dbUser

  constructor(setup: dto.ISetup) {
    this.dbMysql = setup.dbMysql
    this.dbUser = this.dbMysql.prisma().user
  }

  exposableFieldBySearch = (field: string): IDbFields => {
    const exp = { ...FIELD_LIST_USER }
    if (field) {
      exp.email = field.includes('email') ?? false
      exp.phone = field.includes('phone') ?? false
      exp.firstName = field.includes('first_name') ?? false
      exp.lastName = field.includes('last_name') ?? false
    }
    return exp
  }

  listUserDb = async (set: dto.IHttpSet, r: IListUserReq, flag = 'exclude_deleted'): Promise<object> => {
    lib.log(`#${set.headers.trace}-userrepo.listuserdb()`)
    let { pg_size, pg_num, skip } = calculatePage(r)
    let { result, total, count } = await this.dbMysql.wrapException(async () => {
      const f = this.exposableFieldBySearch(r.fields)
      const whereRules = {
        ...(!r.search
          ? {}
          : {
              OR: [
                { email: f.email ? { contains: r.search } : {} },
                { phone: f.phone ? { contains: r.search } : {} },
                { firstName: f.firstName ? { contains: r.search } : {} },
                { lastName: f.lastName ? { contains: r.search } : {} },
              ],
            }),
        ...(flag == 'exclude_deleted' ? { deletedAt: null } : {}),
      }

      const result = await this.dbUser.findMany({
        select: f,
        where: whereRules,
        take: pg_size,
        skip,
      })
      const total = await this.dbUser.count({ where: whereRules })
      const count = result.length
      return { result, total, count }
    })
    const pagination = { count, pg_num, pg_size, total }
    return mapResultWithPagination(pagination, mapFieldToJson(result as any))
  }

  detailUserDb = async (set: dto.IHttpSet, r: IDetailUserReq): Promise<object> => {
    lib.log(`#${set.headers.trace}-userrepo.detailuserdb()`)
    let result = await this.dbMysql.wrapException(async () => {
      return await this.dbUser.findMany({
        select: FIELD_DETAIL_USER,
        where: {
          uuid: { in: r.uuid },
          deletedAt: null,
        },
      })
    })
    result = mapFieldToJson(result as any)
    return mapResult(result)
  }

  deleteUserDb = async (set: dto.IHttpSet, r: IDeleteUserReq, flag = 'soft_delete'): Promise<object> => {
    await this.dbMysql.wrapException(async () => {
      if (flag == 'hard_delete') {
        lib.log(`#${set.headers.trace}-userrepo.deleteuserdb()-hard_delete`)
        return await this.dbUser.deleteMany({
          where: {
            uuid: { in: r.uuid },
          },
        })
      }

      // default soft_delete
      lib.log(`#${set.headers.trace}-userrepo.deleteuserdb()-soft_delete`)
      return await this.dbUser.updateMany({
        where: {
          uuid: { in: r.uuid },
        },
        data: {
          deletedAt: new Date(),
        },
      })
    })
    return mapResult({})
  }

  addUserDb = async (set: dto.IHttpSet, r: ISignupReq): Promise<object> =>
    this.dbMysql.wrapException(async () => {
      lib.log(`#${set.headers.trace}-userrepo.adduserdb()`)
      r.password = await lib.hash(r.password)
      return await this.dbUser.create({ data: mapSignUpDb(r) as any })
    })

  updateUserDbByEmail = async (set: dto.IHttpSet, email: string, updatedData: object): Promise<object> =>
    await this.dbUser.update({
      where: {
        email,
      },
      data: {
        lastLogin: new Date(),
      },
    })

  signInDb = async (set: dto.IHttpSet, r: ISigninReq): Promise<object> => {
    const user = await this.dbMysql.wrapException(async () => {
      return await this.dbUser.findFirst({
        select: FIELD_SIGNIN_USER,
        where: {
          OR: [...(r.email ? [{ email: r.email }] : [{}]), ...(r.phone ? [{ phone: r.phone }] : [{}])],
          basicId: true,
        },
      })
    })

    if (user) {
      lib.log(`#${set.headers.trace}-userrepo.signindb()-user_found`)
      const match = await lib.verifyHash(r.password, user.password)
      if (match) {
        lib.log(`#${set.headers.trace}-userrepo.signindb()-pass_match`)
        // update user last login time
        this.updateUserDbByEmail(set, r.email, { lastLogin: new Date() })
        const exposeUser = { ...user } as Partial<any>
        delete exposeUser.password
        return mapResult(exposeUser)
      }

      return {
        data: null,
        error: { code: 'PU002', message: C.ERROR_MSG['PU002'] },
      }
    }

    return {
      data: null,
      error: { code: 'PU001', message: C.ERROR_MSG['PU001'] },
    }
  }
}
